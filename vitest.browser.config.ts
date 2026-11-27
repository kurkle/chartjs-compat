import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

// CPU rasterization in both browsers, as in the other kurkle chart packages.
// These belong to the provider: Vitest ignores launch options set on an instance.
const chromiumArgs = [
  '--disable-accelerated-2d-canvas',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
]

const firefoxPrefs = {
  'gfx.canvas.accelerated': false,
  'layers.acceleration.disabled': true,
}

export default defineConfig({
  test: {
    browser: {
      enabled: true,
      headless: true,
      instances: [{ browser: 'chromium' }, { browser: 'firefox' }],
      provider: playwright({
        launchOptions: { args: chromiumArgs, firefoxUserPrefs: firefoxPrefs },
      }),
      screenshotFailures: false,
    },
    coverage: {
      include: ['src/**/*.js'],
      provider: 'istanbul',
      reporter: ['text-summary', 'lcov'],
      reportsDirectory: 'coverage/browser',
    },
    include: ['test/specs/**/*.spec.js'],
  },
})
