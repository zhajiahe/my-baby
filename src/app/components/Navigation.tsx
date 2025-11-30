'use client'

interface NavigationProps {
  activeTab: string
  setActiveTab: (tab: string) => void
}

const navItems = [
  { id: 'dashboard', label: '首页', icon: '🏠' },
  { id: 'growth', label: '成长记录', icon: '📊' },
  { id: 'milestones', label: '随心记', icon: '🏆' },
  { id: 'photos', label: '照片墙', icon: '📸' },
]

export default function Navigation({ activeTab, setActiveTab }: NavigationProps) {
  return (
    <>
      {/* 桌面端顶部导航 */}
      <nav className="nav-bar sticky top-0 z-50 hidden md:block">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center space-x-2">
              <h1 className="text-lg font-bold">小好小宇宙</h1>
            </div>
            
            <div className="flex space-x-1">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all duration-200 ${
                    activeTab === item.id
                      ? 'bg-teal-600 text-white font-semibold'
                      : 'nav-item-inactive'
                  }`}
                >
                  <span className="text-sm">{item.icon}</span>
                  <span className="font-medium text-sm">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </nav>

      {/* 移动端顶部标题 */}
      <header className="nav-bar sticky top-0 z-50 md:hidden">
        <div className="flex items-center justify-center h-12 px-4">
          <h1 className="text-base font-bold">小好小宇宙</h1>
        </div>
      </header>

      {/* 移动端底部导航 */}
      <nav className="nav-bar-bottom fixed bottom-0 left-0 right-0 z-50 md:hidden safe-area-bottom">
        <div className="grid grid-cols-4 h-16">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`flex flex-col items-center justify-center gap-0.5 transition-colors ${
                activeTab === item.id
                  ? 'text-teal-500'
                  : 'nav-item-inactive'
              }`}
            >
              <span className="text-xl">{item.icon}</span>
              <span className="text-xs font-medium">{item.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </>
  )
} 