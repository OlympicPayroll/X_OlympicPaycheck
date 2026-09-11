import { act, fireEvent } from '@testing-library/react-native';
import { AccessibilityInfo, Platform, Pressable, Text } from 'react-native';

import { useSnackbar, type SnackbarOptions } from '@/lib/snackbar';

import { renderApp } from './test-utils';

/**
 * The bar at the bottom of the screen: how long it stays, what replaces it,
 * and whether someone using a screen reader hears it and can reach its action.
 */

const screenReaderOn = AccessibilityInfo.isScreenReaderEnabled as jest.Mock;
const recommendedTimeout = AccessibilityInfo.getRecommendedTimeoutMillis as jest.Mock;
const announce = AccessibilityInfo.announceForAccessibility as jest.Mock;

const SAVED = 'PDF saved to your phone';

/** `Platform.OS` is a plain property on the RN Platform object. */
function setPlatform(os: 'ios' | 'android') {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true, writable: true });
}

/** One button per message, standing in for the screens that show them. */
function Harness({ messages }: { messages: SnackbarOptions[] }) {
  const snackbar = useSnackbar();
  return (
    <>
      {messages.map((options, i) => (
        <Pressable key={i} onPress={() => snackbar.show(options)}>
          <Text>{`Show ${i}`}</Text>
        </Pressable>
      ))}
    </>
  );
}

const wait = (ms: number) => act(() => jest.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
  setPlatform('ios');
});

it('goes away by itself after about seven seconds', async () => {
  const app = await renderApp(<Harness messages={[{ message: SAVED }]} />);

  await fireEvent.press(app.getByText('Show 0'));
  await wait(6_900);
  expect(app.getByText(SAVED)).toBeTruthy();

  await wait(200);
  expect(app.queryByText(SAVED)).toBeNull();
});

it('lets a newer message replace the one on screen, with its own time', async () => {
  const app = await renderApp(<Harness messages={[{ message: 'First' }, { message: 'Second' }]} />);

  await fireEvent.press(app.getByText('Show 0'));
  await wait(5_000);
  await fireEvent.press(app.getByText('Show 1'));

  expect(app.queryByText('First')).toBeNull();
  await wait(5_000);
  expect(app.getByText('Second')).toBeTruthy();

  await wait(2_100);
  expect(app.queryByText('Second')).toBeNull();
});

it('is read out by VoiceOver on iOS, and left to the live region on Android', async () => {
  setPlatform('ios');
  const app = await renderApp(<Harness messages={[{ message: SAVED }]} />);

  await fireEvent.press(app.getByText('Show 0'));
  expect(announce).toHaveBeenCalledWith(SAVED);

  announce.mockClear();
  setPlatform('android');
  await fireEvent.press(app.getByText('Show 0'));
  expect(announce).not.toHaveBeenCalled();
});

it('waits for a screen reader user to reach the action, and lets them dismiss it', async () => {
  screenReaderOn.mockResolvedValueOnce(true);
  const open = jest.fn();
  const app = await renderApp(<Harness messages={[{ message: SAVED, action: { label: 'Open', onPress: open } }]} />);

  await fireEvent.press(app.getByText('Show 0'));
  await wait(60_000);
  expect(app.getByText('Open')).toBeTruthy();

  await fireEvent(app.getByLabelText(SAVED), 'accessibilityAction', { nativeEvent: { actionName: 'dismiss' } });

  expect(app.queryByText(SAVED)).toBeNull();
  expect(open).not.toHaveBeenCalled();
});

it('stays up longer when Android’s “Time to take action” setting asks for it', async () => {
  setPlatform('android');
  recommendedTimeout.mockResolvedValueOnce(20_000);
  const app = await renderApp(<Harness messages={[{ message: SAVED }]} />);

  await fireEvent.press(app.getByText('Show 0'));
  await wait(10_000);
  expect(app.getByText(SAVED)).toBeTruthy();

  await wait(10_100);
  expect(app.queryByText(SAVED)).toBeNull();
});
