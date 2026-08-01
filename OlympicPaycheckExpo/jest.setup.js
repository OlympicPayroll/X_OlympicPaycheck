/**
 * Test environment for Olympic Paycheck.
 *
 * Only the boundaries the app cannot own in a test runner are mocked here — the
 * OS keychain, the biometric prompt, the navigator, and the animation driver.
 * Everything above those boundaries (screens, session, escalation rules, the
 * fixture payroll backend) is the real code under test.
 */

// --- Animations -------------------------------------------------------------
// Reanimated ships its own Jest mock; without it every animated screen throws.
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

// --- Navigation -------------------------------------------------------------
// Tests assert on navigation by importing `router` and reading the jest.fn()s.
jest.mock('expo-router', () => {
  const router = {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    navigate: jest.fn(),
    dismissAll: jest.fn(),
    setParams: jest.fn(),
  };
  return {
    router,
    useRouter: () => router,
    useLocalSearchParams: () => ({}),
    useSegments: () => [],
    usePathname: () => '/',
    useFocusEffect: () => {},
  };
});

// --- Keychain / keystore ----------------------------------------------------
// A real in-memory store, so "save then read back" genuinely round-trips and
// `clearCredential` is observably destructive.
jest.mock('expo-secure-store', () => ({
  __store: new Map(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly',
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

// --- Biometric hardware -----------------------------------------------------
// Defaults describe a healthy Face ID phone; individual tests override.
jest.mock('expo-local-authentication', () => ({
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 },
  hasHardwareAsync: jest.fn(async () => true),
  isEnrolledAsync: jest.fn(async () => true),
  supportedAuthenticationTypesAsync: jest.fn(async () => [2]),
  authenticateAsync: jest.fn(async () => ({ success: true })),
}));

// --- Execution environment --------------------------------------------------
// Not Expo Go, so the Face-ID-in-Expo-Go guard in biometrics.ts stays inert.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { executionEnvironment: 'bare' },
  ExecutionEnvironment: { Bare: 'bare', Standalone: 'standalone', StoreClient: 'storeClient' },
}));

// --- Per-test isolation -----------------------------------------------------
const SecureStore = require('expo-secure-store');
const LocalAuthentication = require('expo-local-authentication');
const { router } = require('expo-router');

// Every mock is reset and re-armed, so call counts and one-off overrides never
// leak from one test into the next.
beforeEach(() => {
  const store = SecureStore.__store;
  store.clear();

  SecureStore.getItemAsync.mockReset().mockImplementation(async (key) => (store.has(key) ? store.get(key) : null));
  SecureStore.setItemAsync.mockReset().mockImplementation(async (key, value) => {
    store.set(key, value);
  });
  SecureStore.deleteItemAsync.mockReset().mockImplementation(async (key) => {
    store.delete(key);
  });

  router.push.mockReset();
  router.replace.mockReset();
  router.back.mockReset();
  router.navigate.mockReset();

  // The defaults describe a healthy Face ID phone; tests override as needed.
  LocalAuthentication.hasHardwareAsync.mockReset().mockResolvedValue(true);
  LocalAuthentication.isEnrolledAsync.mockReset().mockResolvedValue(true);
  LocalAuthentication.supportedAuthenticationTypesAsync.mockReset().mockResolvedValue([2]);
  LocalAuthentication.authenticateAsync.mockReset().mockResolvedValue({ success: true });
});
