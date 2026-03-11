<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useNetworkActivityStore } from '@/stores/networkActivity'

const networkActivityStore = useNetworkActivityStore()
const { isActive } = storeToRefs(networkActivityStore)
</script>

<template>
  <div class="app-frame">
    <Transition name="ui-fade" appear>
      <div
        v-if="isActive"
        class="global-network-loader"
        role="progressbar"
        aria-label="Network activity in progress"
        aria-valuetext="Loading"
      />
    </Transition>
    <RouterView v-slot="{ Component, route }">
      <Transition name="ui-fade" mode="out-in" appear>
        <component :is="Component" :key="route.fullPath" />
      </Transition>
    </RouterView>
  </div>
</template>
