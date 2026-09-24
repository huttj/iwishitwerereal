export interface Me {
  id: string
  email: string
  name: string | null
  /** Upload URL of a small square photo, or null for initials. */
  avatar: string | null
  isAdmin: boolean
}

export interface UserSummary {
  id: string
  email: string
  name: string | null
  avatar: string | null
  isAdmin: boolean
  addedBy: string | null
  addedAt: number
  lastLoginAt: number | null
}

/** The public face of a member: enough to label their cursor and their shapes. */
export interface Person {
  id: string
  name: string | null
  avatar: string | null
}

/** Who made and last touched a shape. Lives on the record as `meta`. */
export interface Attribution {
  createdBy?: string
  createdAt?: number
  editedBy?: string
  editedAt?: number
}

/** A tldraw store record as the old room persisted it (shape, asset, binding, page…). */
export interface LegacyRecord {
  id: string
  typeName: string
  [key: string]: unknown
}

export interface ApiError {
  error: string
}
