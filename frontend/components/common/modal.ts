import { Platform } from 'react-native';

/**
 * react-native-web only unmounts a closed Modal after its exit animation fires `animationend`,
 * which browsers skip for background/minimised tabs, leaving an invisible layer mounted.
 * Modals therefore open without animation on web.
 */
export const MODAL_ANIMATION_FADE = Platform.OS === 'web' ? 'none' : 'fade';
export const MODAL_ANIMATION_SLIDE = Platform.OS === 'web' ? 'none' : 'slide';
