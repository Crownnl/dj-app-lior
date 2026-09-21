import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.djdeck.app',
  appName: 'DJ Deck',
  webDir: 'dist',
  backgroundColor: '#0d0e12',
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#0d0e12',
      androidScaleType: 'CENTER_CROP',
    },
  },
};

export default config;
