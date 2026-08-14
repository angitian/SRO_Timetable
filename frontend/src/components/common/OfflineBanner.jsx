import { useState, useEffect } from 'react'
import { WifiOff, CloudOff, RefreshCw } from 'lucide-react'
import { isOnline, formatLastSync, getCachedMeta } from '../../utils/cache.js'

export default function OfflineBanner({ cacheKey }) {
  const [online, setOnline] = useState(isOnline())
  const [lastSync, setLastSync] = useState(null)

  useEffect(() => {
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    if (cacheKey) {
      getCachedMeta(cacheKey).then((meta) => {
        if (meta) setLastSync(meta.lastSync)
      })
    }

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [cacheKey])

  if (online) return null

  return (
    <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-2 flex items-center justify-between">
      <div className="flex items-center gap-2 text-sm text-yellow-800">
        <WifiOff className="w-4 h-4" />
        <span>คุณกำลังออฟไลน์ — แสดงข้อมูลจากแคช{lastSync ? ` (อัปเดตล่าสุด: ${formatLastSync(lastSync)})` : ''}</span>
      </div>
      <button
        onClick={() => window.location.reload()}
        className="text-sm text-yellow-700 hover:text-yellow-900 flex items-center gap-1"
      >
        <RefreshCw className="w-3.5 h-3.5" /> ลองใหม่
      </button>
    </div>
  )
}
