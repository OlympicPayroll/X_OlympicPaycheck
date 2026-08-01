// Ambient declarations so `tsc` accepts side-effect CSS imports (global.css etc.)
// that Metro/NativeWind handle at bundle time.
declare module '*.css';
