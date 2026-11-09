/**
 * Read-only trainee roster for pages that are not the trainee module
 * (timetable grid, daily substitute, print studio).
 *
 * Reuses the trainee module's local cache + cloud sync logic but never
 * mutates, so it is safe to mount from any workspace page.
 */
import { useMemo } from 'react'
import { useApp } from '../context/AppContext.jsx'
import useTraineeWorkspace from './useTraineeWorkspace.js'

export default function useTraineeRoster() {
  const { activeWorkspace, activeTraineeWorkspace, user } = useApp()

  const timetableId = activeTraineeWorkspace?.timetableId || activeWorkspace?.id || null
  const cloudEnabled = activeTraineeWorkspace
    ? true
    : activeWorkspace?.kind === 'cloud' && !!user

  const workspace = useTraineeWorkspace(timetableId, {
    cloudEnabled,
    canEdit: false,
    initialReference: null,
  })

  const trainees = useMemo(
    () => (workspace.data?.trainees || []).filter((t) => t && !t.archived),
    [workspace.data],
  )

  return {
    trainees,
    reference: workspace.data?.reference || null,
    loading: workspace.loading,
    error: workspace.error,
    timetableId,
  }
}
