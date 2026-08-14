// ============================================================================
// INTEGRITY FLAGGING
// ============================================================================
// IMPORTANT FRAMING: none of this proves who actually answered the
// questions -- there's no camera or audio, and a genuinely careful
// teacher can still trigger a false flag (e.g. two students who happen
// to answer identically). What this DOES do is surface the small
// percentage of submissions worth a human looking at, out of what's
// otherwise an unreviewable volume across hundreds of schools. Every
// flag should be read as "worth a second look," not "confirmed fraud."
//
// Flags implemented:
//   - too_fast          Completed implausibly quickly for 26 questions
//                        asked of a real child
//   - straight_line      Every question given the identical answer
//   - duplicate_pattern   Byte-identical answer set to another student's
//                        assessment submitted by the same teacher
//   - no_location        Device didn't provide GPS coordinates at all
//   - location_outlier    Submitted from far outside where this school's
//                        other submissions normally come from
// ============================================================================

const TOO_FAST_SECONDS = 90 // ~3.5s/question minimum for 26 questions -- generous floor, not a real pace
const OUTLIER_RADIUS_METERS = 2000 // rural GPS drift is real; keep this loose to avoid false alarms
const MIN_SAMPLES_FOR_SCHOOL_LOCATION = 3 // don't judge a school's "normal" location off only 1-2 points

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const toRad = d => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function median(nums) {
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// answers: { questionCode: 'yes'|'partial'|'no', ... }
function answerFingerprint(answers) {
  return Object.keys(answers).sort().map(k => `${k}:${answers[k]}`).join('|')
}

/**
 * Computes flags for every assessment in one pass.
 * @param assessments Array of { uuid, teacherId, schoolId, startedAt, completedAt,
 *                                latitude, longitude, answers }
 * @param schools     Array of { id, latitude, longitude } (admin-set reference, may be null)
 * @returns Map of uuid -> string[] of flag codes
 */
export function computeIntegrityFlags(assessments, schools) {
  const flags = new Map(assessments.map(a => [a.uuid, []]))

  // ---- straight_line & too_fast: purely per-assessment, no cross-referencing needed ----
  for (const a of assessments) {
    const answerValues = Object.values(a.answers)
    if (answerValues.length > 1 && new Set(answerValues).size === 1) {
      flags.get(a.uuid).push('straight_line')
    }
    if (a.startedAt && a.completedAt) {
      const seconds = (new Date(a.completedAt) - new Date(a.startedAt)) / 1000
      if (seconds > 0 && seconds < TOO_FAST_SECONDS) {
        flags.get(a.uuid).push('too_fast')
      }
    }
    if (a.latitude == null || a.longitude == null) {
      flags.get(a.uuid).push('no_location')
    }
  }

  // ---- duplicate_pattern: group by teacher, compare answer fingerprints ----
  const byTeacher = {}
  for (const a of assessments) {
    byTeacher[a.teacherId] = byTeacher[a.teacherId] || []
    byTeacher[a.teacherId].push(a)
  }
  for (const teacherAssessments of Object.values(byTeacher)) {
    const byFingerprint = {}
    for (const a of teacherAssessments) {
      const fp = answerFingerprint(a.answers)
      if (!fp) continue
      byFingerprint[fp] = byFingerprint[fp] || []
      byFingerprint[fp].push(a.uuid)
    }
    for (const uuids of Object.values(byFingerprint)) {
      if (uuids.length > 1) {
        for (const uuid of uuids) flags.get(uuid).push('duplicate_pattern')
      }
    }
  }

  // ---- location_outlier: compare each submission against its school's expected location ----
  const schoolRef = {}
  for (const s of schools) {
    if (s.latitude != null && s.longitude != null) {
      schoolRef[s.id] = { lat: s.latitude, lng: s.longitude, source: 'admin-set' }
    }
  }
  // For schools with no admin-set reference, infer one from the median of
  // their own submissions (only once there's enough data to be meaningful).
  const bySchool = {}
  for (const a of assessments) {
    if (a.latitude == null || a.longitude == null) continue
    bySchool[a.schoolId] = bySchool[a.schoolId] || []
    bySchool[a.schoolId].push(a)
  }
  for (const [schoolId, list] of Object.entries(bySchool)) {
    if (schoolRef[schoolId] || list.length < MIN_SAMPLES_FOR_SCHOOL_LOCATION) continue
    schoolRef[schoolId] = {
      lat: median(list.map(a => a.latitude)),
      lng: median(list.map(a => a.longitude)),
      source: 'inferred'
    }
  }
  for (const a of assessments) {
    const ref = schoolRef[a.schoolId]
    if (!ref || a.latitude == null || a.longitude == null) continue
    const distance = haversineMeters(a.latitude, a.longitude, ref.lat, ref.lng)
    if (distance > OUTLIER_RADIUS_METERS) {
      flags.get(a.uuid).push('location_outlier')
    }
  }

  return flags
}

export const FLAG_LABELS = {
  too_fast: 'Completed unusually fast',
  straight_line: 'Same answer for every question',
  duplicate_pattern: 'Identical to another submission by this teacher',
  no_location: 'No location data',
  location_outlier: 'Far from this school\u2019s usual location'
}
