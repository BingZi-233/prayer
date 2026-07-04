---
home: true
heroText: ""
tagline: ""
---

<ClientOnly>
  <div class="iframe-full">
    <div v-if="isLoading" class="iframe-loading">
      <div class="spinner" aria-hidden="true"></div>
      <p class="loading-text">正在加载...</p>
    </div>
    <iframe
      id="iframe"
      scrolling="yes"
      frameborder="0"
      allowfullscreen="true"
      src="https://check.linux.do/group/Packy"
      @load="handleLoad"
    ></iframe>
    <div class="iframe-scroll-mask"></div>
  </div>
</ClientOnly>

<script setup>
import { onMounted, onBeforeUnmount, ref } from "vue";

const BODY_LOCK_CLASS = "monitor-scroll-lock";
const isLoading = ref(true);

const handleLoad = () => {
  isLoading.value = false;
};

onMounted(() => {
  document.body.classList.add(BODY_LOCK_CLASS);
});

onBeforeUnmount(() => {
  document.body.classList.remove(BODY_LOCK_CLASS);
});
</script>

<style scoped>
.iframe-full {
  margin: 0;
  padding: 0;
  position: relative;
  width: 100vw;
  max-width: 100vw;
  margin-left: calc(50% - 50vw);
  height: calc(100vh - var(--navbar-height, 56px));
  overflow: hidden;
}

.iframe-full iframe {
  display: block;
  width: 100vw;
  max-width: 100vw;
  height: 100%;
  border: 0;
}

.iframe-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.85), rgba(245, 247, 250, 0.9));
  color: var(--text-color, #1f2d3d);
  font-size: 14px;
  letter-spacing: 0.5px;
  z-index: 2;
  pointer-events: none;
}

.loading-text {
  margin: 0;
}

.spinner {
  width: 42px;
  height: 42px;
  border: 3px solid rgba(31, 45, 61, 0.15);
  border-top-color: var(--accent-color, #409eff);
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
  -webkit-animation: spin 0.9s linear infinite;
  will-change: transform;
}

.theme-hope-content {
  padding: 0;
  margin: 0;
  min-height: 100vh;
  overflow: hidden;
}

:global(body.monitor-scroll-lock) {
  margin: 0;
  overflow: hidden;
}

#iframe::-webkit-scrollbar {
  display: none;
}
#iframe {
  scrollbar-width: none;
}

.iframe-scroll-mask {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 12px;
  background: var(--bg-color, #fff);
  pointer-events: none;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@-webkit-keyframes spin {
  from {
    -webkit-transform: rotate(0deg);
  }
  to {
    -webkit-transform: rotate(360deg);
  }
}
</style>
