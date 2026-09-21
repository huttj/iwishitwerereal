export interface Me {
  id: string
  email: string
  name: string | null
  isAdmin: boolean
}

export interface UserSummary {
  id: string
  email: string
  name: string | null
  isAdmin: boolean
  addedBy: string | null
  addedAt: number
  lastLoginAt: number | null
}

export interface ApiError {
  error: string
}
