import { useEffect, useState, useRef } from 'react'
import { CheckCircle, XCircle, Loader2 } from 'lucide-react'
import { setAuthToken, fetchMe, getUserId, mergeGuestWorkspaces } from '../api/client.js'

/**
 * AuthCallback — receives the JWT token from the Google OAuth redirect.
 *
 * URL: /auth/callback?token=<jwt>  (success)
 *      /auth/callback?error=<reason>  (user cancelled or error)
 *
 * On success: stores the token, fetches the user profile, merges any guest
 * workspaces into the logged-in account, then redirects to the home page.
 *
 * Note: this app uses window.location for routing (no react-router), so we
 * redirect via window.location.href.
 */
export default function AuthCallback() {
  const [status, setStatus] = useState('loading') // 'loading' | 'ok' | 'err'
  const [errorMsg, setErrorMsg] = useState('')
  const mergedRef = useRef(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')
    const error = params.get('error')

    if (error) {
      setStatus('err')
      setErrorMsg(error === 'access_denied' ? 'คุณยกเลิกการเข้าสู่ระบบ' : `เกิดข้อผิดพลาด: ${error}`)
      window.history.replaceState({}, '', '/auth/callback')
      return
    }

    if (!token) {
      setStatus('err')
      setErrorMsg('ไม่ได้รับ token จากการเข้าสู่ระบบ')
      return
    }

    setAuthToken(token)

    // Fetch user profile to confirm the token works
    fetchMe()
      .then(async (user) => {
        if (!user) {
          setStatus('err')
          setErrorMsg('Token ไม่ถูกต้องหรือหมดอายุ')
          return
        }

        // Merge any guest workspaces (saved with device id) into this account
        if (!mergedRef.current) {
          mergedRef.current = true
          try {
            const deviceId = getUserId()
            await mergeGuestWorkspaces(deviceId)
          } catch (e) {
            // Non-fatal — merge failure shouldn't block login
            console.warn('[AuthCallback] merge-guest failed:', e.message)
          }
        }

        setStatus('ok')
        // Redirect home after a brief delay so the user sees the success state
        setTimeout(() => {
          window.location.href = '/'
        }, 800)
      })
      .catch(() => {
        setStatus('err')
        setErrorMsg('ไม่สามารถดึงข้อมูลผู้ใช้ได้')
      })
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm w-full mx-4 text-center">
        {status === 'loading' && (
          <>
            <Loader2 className="w-12 h-12 text-blue-500 mx-auto mb-4 animate-spin" />
            <h2 className="text-lg font-bold text-gray-800 mb-1">กำลังเข้าสู่ระบบ...</h2>
            <p className="text-sm text-gray-500">กรุณารอสักครู่</p>
          </>
        )}
        {status === 'ok' && (
          <>
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <h2 className="text-lg font-bold text-gray-800 mb-1">เข้าสู่ระบบสำเร็จ</h2>
            <p className="text-sm text-gray-500">กำลังนำคุณกลับ...</p>
          </>
        )}
        {status === 'err' && (
          <>
            <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-lg font-bold text-gray-800 mb-1">เข้าสู่ระบบไม่สำเร็จ</h2>
            <p className="text-sm text-gray-500 mb-4">{errorMsg}</p>
            <button
              onClick={() => { window.location.href = '/' }}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium text-sm hover:bg-blue-700 transition-colors"
            >
              กลับหน้าหลัก
            </button>
          </>
        )}
      </div>
    </div>
  )
}
