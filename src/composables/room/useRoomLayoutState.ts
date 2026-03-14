import { ref, watch, type Ref } from 'vue'
import { useRoute } from 'vue-router'

export function useRoomLayoutState(showHostDisconnectedModal: Ref<boolean>) {
  const route = useRoute()
  const isLeftDrawerOpen = ref(false)
  const isRightDrawerOpen = ref(false)

  watch(
    () => route.fullPath,
    () => {
      isLeftDrawerOpen.value = false
      isRightDrawerOpen.value = false
    }
  )

  watch(showHostDisconnectedModal, (isVisible) => {
    if (!isVisible) {
      return
    }

    isLeftDrawerOpen.value = false
    isRightDrawerOpen.value = false
  })

  function openLeftDrawer() {
    isRightDrawerOpen.value = false
    isLeftDrawerOpen.value = true
  }

  function closeLeftDrawer() {
    isLeftDrawerOpen.value = false
  }

  function openRightDrawer() {
    isLeftDrawerOpen.value = false
    isRightDrawerOpen.value = true
  }

  function closeRightDrawer() {
    isRightDrawerOpen.value = false
  }

  return {
    isLeftDrawerOpen,
    isRightDrawerOpen,
    openLeftDrawer,
    closeLeftDrawer,
    openRightDrawer,
    closeRightDrawer,
  }
}
