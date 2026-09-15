const TOO_FAST_SECONDS = 90
const OUTLIER_RADIUS_METERS = 2000
const MIN_SAMPLES_FOR_SCHOOL_LOCATION = 3

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

function answerFingerprint(answers) {
  return Object.keys(answers).sort().map(k => `${k}:${answers[k]}`).join('|')
}

export function computeIntegrityFlags(assessments, schools) {
  const flags = new Map(assessments.map(a => [a.uuid, []]))

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

  const schoolRef = {}
  for (const s of schools) {
    if (s.latitude != null && s.longitude != null) {
      schoolRef[s.id] = { lat: s.latitude, lng: s.longitude, source: 'admin-set' }
    }
  }
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
