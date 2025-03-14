<script setup lang="ts">
import type { TimelineEventFunction } from '../../types'

const props = defineProps<{
  record: TimelineEventFunction
}>()

const config = useServerConfig()
const timeAgo = useTimeAgo(() => props.record.start, { showSecond: true })

function urlToFilepath(url: string) {
  let pathname = new URL(url).pathname
  if (pathname.startsWith('/_nuxt/'))
    pathname = pathname.slice(6)
  if (pathname.startsWith('/@id/virtual:nuxt:'))
    return `#build/${pathname.split('/.nuxt/')[1]}`.replace(/\.m?js$/, '')
  if (pathname.includes('/@fs/'))
    return `/${pathname.split('/@fs/')[1]}`
  return (config.value?.rootDir || '') + pathname
}

const autoImports = useAutoImports()
const importsMetadata = computed(() => autoImports.value?.metadata)
const importItem = computed(() => {
  return autoImports.value?.imports.find(i => i.as === props.record.name)
})
</script>

<template>
  <div v-if="record" p-4 flex="~ col gap-2" text-base>
    <div mx--1>
      <NBadge n="yellow" v-text="'Function call'" />
    </div>
    <div flex="~ gap-1" font-mono>
      <ComposableItem
        v-if="importItem"
        :item="importItem"
        :metadata="importsMetadata"
        :counter="false"
        classes="px2 py1"
        mx--2
      />
      <span v-else>{{ record.name }}</span>
      <span ml1 op30>(</span>
      <template v-for="arg, idx in record.args" :key="idx">
        <span v-if="idx" op30>, </span>
        <TimelineArgumentView :value="arg" />
      </template>
      <span op30>)</span>
    </div>

    <div flex="~ gap-1" text-sm>
      <DurationDisplay
        v-if="record.end"
        :duration="record.end - record.start"
      />
      <span mx1 op50>·</span>
      <div class="text-sm text-gray-400">
        {{ timeAgo }}
      </div>
    </div>

    <div v-if="record.stacktrace" class="text-xs text-gray-400" mt2 grid="~ cols-[max-content_1fr] gap-x-4" font-mono>
      <template v-for="item, idx of record.stacktrace" :key="idx">
        <div text-right>
          {{ item.functionName || `(anonymous)` }}
        </div>
        <div ws-nowrap>
          <FilepathItem
            v-if="item.fileName"
            :filepath="`${urlToFilepath(item.fileName)}:${item.lineNumber}:${item.columnNumber}`"
            subpath
          />
        </div>
      </template>
    </div>
  </div>
</template>
