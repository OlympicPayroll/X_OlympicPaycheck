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
// Route params are a mutable box rather than a constant, so a test can render a
// screen "as if" it were reached with particular params (e.g. ?manual=1).
jest.mock('expo-router', () => {
  const router = {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    navigate: jest.fn(),
    dismissAll: jest.fn(),
    setParams: jest.fn(),
  };
  const params = { current: {} };
  return {
    router,
    __params: params,
    /** Test helper: set the params the next render will observe. */
    __setParams: (next) => {
      params.current = next;
    },
    useRouter: () => router,
    useLocalSearchParams: () => params.current,
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
  // Mirrors expo-local-authentication's SecurityLevel: NONE / SECRET /
  // BIOMETRIC_WEAK / BIOMETRIC_STRONG. Android capability detection turns on
  // the difference between the last two.
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
  hasHardwareAsync: jest.fn(async () => true),
  isEnrolledAsync: jest.fn(async () => true),
  getEnrolledLevelAsync: jest.fn(async () => 3),
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

// --- PDF export -------------------------------------------------------------
// The OS print engine, share sheet and file system. The HTML handed to the
// print engine is the document itself, so that is what tests assert on.
jest.mock('expo-print', () => ({
  printToFileAsync: jest.fn(),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn(),
}));

// A pretend disk, so `exists`, `move` and `delete` behave like real files.
jest.mock('expo-file-system', () => {
  const disk = new Set();
  const join = (parts) =>
    parts
      .map((part) => (typeof part === 'string' ? part : part.uri))
      .join('/')
      .replace(/([^:/])\/{2,}/g, '$1/');

  class File {
    constructor(...parts) {
      this.uri = join(parts);
    }
    get exists() {
      return disk.has(this.uri);
    }
    delete() {
      disk.delete(this.uri);
    }
    move(destination) {
      disk.delete(this.uri);
      this.uri = destination.uri;
      disk.add(this.uri);
    }
    write() {
      disk.add(this.uri);
    }
    async bytes() {
      return new Uint8Array([37, 80, 68, 70]);
    }
    async base64() {
      return 'iVBORw0KGgo=';
    }
  }

  class Directory {
    constructor(...parts) {
      this.uri = join(parts);
    }
    createFile(name) {
      return new File(this, name);
    }
  }
  Directory.pickDirectoryAsync = jest.fn();

  return { __disk: disk, File, Directory, Paths: { cache: new Directory('file:///cache') } };
});

// --- Per-test isolation -----------------------------------------------------
const SecureStore = require('expo-secure-store');
const LocalAuthentication = require('expo-local-authentication');
const { router, __setParams } = require('expo-router');

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

  // Fixture backend state (read receipts, photos) behaves like a server and
  // would otherwise leak between tests.
  require('./src/api/mock').resetFixtures();

  router.push.mockReset();
  router.replace.mockReset();
  router.back.mockReset();
  router.navigate.mockReset();
  __setParams({});

  // The defaults describe a healthy Face ID phone; tests override as needed.
  LocalAuthentication.hasHardwareAsync.mockReset().mockResolvedValue(true);
  LocalAuthentication.isEnrolledAsync.mockReset().mockResolvedValue(true);
  LocalAuthentication.getEnrolledLevelAsync.mockReset().mockResolvedValue(3);
  LocalAuthentication.supportedAuthenticationTypesAsync.mockReset().mockResolvedValue([2]);
  LocalAuthentication.authenticateAsync.mockReset().mockResolvedValue({ success: true });

  // PDF export: a phone that can render, share and save.
  const Print = require('expo-print');
  const Sharing = require('expo-sharing');
  const FileSystem = require('expo-file-system');
  FileSystem.__disk.clear();
  Print.printToFileAsync.mockReset().mockResolvedValue({ uri: 'file:///cache/Print/5F2C1A.pdf', numberOfPages: 1 });
  Sharing.isAvailableAsync.mockReset().mockResolvedValue(true);
  Sharing.shareAsync.mockReset().mockResolvedValue(undefined);
  FileSystem.Directory.pickDirectoryAsync
    .mockReset()
    .mockResolvedValue(new FileSystem.Directory('content://downloads'));
  // Bundled images can't be downloaded in a test runner, so the logo arrives
  // as if it were already on disk.
  jest.spyOn(require('expo-asset').Asset, 'fromModule').mockReturnValue({
    downloadAsync: async () => ({ localUri: 'file:///cache/logo-torch.png' }),
  });
});
