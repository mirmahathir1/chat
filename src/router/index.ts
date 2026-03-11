import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '@/views/HomeView.vue'
import RoomView from '@/views/RoomView.vue'

function isReloadNavigation() {
  if (typeof window === 'undefined') {
    return false
  }

  const navigationEntries =
    typeof window.performance?.getEntriesByType === 'function'
      ? window.performance.getEntriesByType('navigation')
      : []
  const navigationEntry = navigationEntries[0] as PerformanceNavigationTiming | undefined

  if (navigationEntry?.type) {
    return navigationEntry.type === 'reload'
  }

  const legacyNavigation = window.performance?.navigation

  return legacyNavigation?.type === legacyNavigation?.TYPE_RELOAD
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
    },
    {
      path: '/room/:roomId',
      name: 'room',
      component: RoomView,
    },
  ],
})

let hasHandledInitialNavigation = false

router.beforeEach((to) => {
  if (hasHandledInitialNavigation) {
    return true
  }

  hasHandledInitialNavigation = true

  if (to.name === 'room' && isReloadNavigation()) {
    return {
      name: 'home',
      replace: true,
    }
  }

  return true
})

export function resetInitialNavigationGuardForTests() {
  hasHandledInitialNavigation = false
}

export default router
