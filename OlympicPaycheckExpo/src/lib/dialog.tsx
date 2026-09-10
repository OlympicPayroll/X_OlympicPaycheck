import { createContext, ReactNode, useCallback, useContext, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Platform-native dialogs:
 *   • iOS      → UIAlertController (Alert) and UIActionSheet (ActionSheetIOS).
 *   • Android  → Material 3 dialogs (28dp corners, tonal surface, text buttons).
 *
 * Usage:  const { confirm, choose } = useDialog();
 */
export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
};

export type ChooseOptions = {
  title: string;
  message?: string;
  options: string[];
  cancelText?: string;
};

type DialogApi = {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  /** Resolves with the chosen index, or null if dismissed. */
  choose: (opts: ChooseOptions) => Promise<number | null>;
};

type Pending =
  | ({ kind: 'confirm'; resolve: (v: boolean) => void } & ConfirmOptions)
  | ({ kind: 'choose'; resolve: (v: number | null) => void } & ChooseOptions);

const DialogContext = createContext<DialogApi | null>(null);

export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog must be used within a DialogProvider');
  return ctx;
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const [pending, setPending] = useState<Pending | null>(null);

  /** The request on screen, readable synchronously so a newer one can retire it. */
  const current = useRef<Pending | null>(null);

  /**
   * Put a request on screen. Only one Material dialog can show at a time, and
   * replacing the state outright left the earlier caller awaiting a dialog
   * that no longer existed. It is settled as dismissed instead, so the code
   * waiting on it can finish.
   */
  const show = useCallback((next: Pending) => {
    const previous = current.current;
    if (previous?.kind === 'confirm') previous.resolve(false);
    if (previous?.kind === 'choose') previous.resolve(null);
    current.current = next;
    setPending(next);
  }, []);

  const close = () => {
    current.current = null;
    setPending(null);
  };

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      if (Platform.OS === 'ios') {
        Alert.alert(opts.title, opts.message, [
          { text: opts.cancelText ?? 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          {
            text: opts.confirmText ?? 'OK',
            style: opts.destructive ? 'destructive' : 'default',
            onPress: () => resolve(true),
          },
        ]);
      } else {
        show({ kind: 'confirm', ...opts, resolve });
      }
    });
  }, [show]);

  const choose = useCallback((opts: ChooseOptions) => {
    return new Promise<number | null>((resolve) => {
      if (Platform.OS === 'ios') {
        const cancel = opts.cancelText ?? 'Cancel';
        ActionSheetIOS.showActionSheetWithOptions(
          {
            title: opts.title,
            message: opts.message,
            options: [...opts.options, cancel],
            cancelButtonIndex: opts.options.length,
          },
          (index) => resolve(index === opts.options.length ? null : index),
        );
      } else {
        show({ kind: 'choose', ...opts, resolve });
      }
    });
  }, [show]);

  const dismiss = () => {
    if (pending?.kind === 'confirm') pending.resolve(false);
    if (pending?.kind === 'choose') pending.resolve(null);
    close();
  };

  const settleConfirm = (value: boolean) => {
    if (pending?.kind === 'confirm') pending.resolve(value);
    close();
  };

  const settleChoose = (index: number) => {
    if (pending?.kind === 'choose') pending.resolve(index);
    close();
  };

  return (
    <DialogContext.Provider value={{ confirm, choose }}>
      {children}

      {/* Android — Material 3 dialog */}
      <Modal visible={pending !== null} transparent animationType="fade" statusBarTranslucent onRequestClose={dismiss}>
        <Pressable style={styles.scrim} onPress={dismiss}>
          <Pressable style={[styles.surface, { backgroundColor: theme.surface }]} onPress={() => {}}>
            <Text style={[styles.title, { color: theme.ink }]}>{pending?.title}</Text>
            {pending?.message ? (
              <Text style={[styles.body, { color: theme.textSecondary }]}>{pending.message}</Text>
            ) : null}

            {pending?.kind === 'choose' ? (
              <View style={styles.list}>
                {pending.options.map((option, i) => (
                  <Pressable
                    key={option}
                    onPress={() => settleChoose(i)}
                    style={({ pressed }) => [styles.listItem, pressed && { backgroundColor: theme.rowFill }]}
                  >
                    <Text style={[styles.listLabel, { color: theme.ink }]}>{option}</Text>
                  </Pressable>
                ))}
                <View style={styles.actions}>
                  <Pressable
                    style={({ pressed }) => [styles.textBtn, pressed && { backgroundColor: theme.rowFill }]}
                    onPress={dismiss}
                  >
                    <Text style={[styles.textBtnLabel, { color: theme.brand }]}>{pending.cancelText ?? 'Cancel'}</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={styles.actions}>
                <Pressable
                  style={({ pressed }) => [styles.textBtn, pressed && { backgroundColor: theme.rowFill }]}
                  onPress={() => settleConfirm(false)}
                >
                  <Text style={[styles.textBtnLabel, { color: theme.brand }]}>
                    {(pending?.kind === 'confirm' && pending.cancelText) || 'Cancel'}
                  </Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.textBtn, pressed && { backgroundColor: theme.rowFill }]}
                  onPress={() => settleConfirm(true)}
                >
                  <Text
                    style={[
                      styles.textBtnLabel,
                      { color: pending?.kind === 'confirm' && pending.destructive ? theme.danger : theme.brand },
                    ]}
                  >
                    {(pending?.kind === 'confirm' && pending.confirmText) || 'OK'}
                  </Text>
                </Pressable>
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </DialogContext.Provider>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  surface: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 28, // Material 3 dialog corner
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 18,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  title: { fontSize: 22, fontWeight: '500', letterSpacing: 0 },
  body: { fontSize: 14, lineHeight: 20, marginTop: 12 },
  list: { marginTop: 12 },
  listItem: { paddingVertical: 14, borderRadius: Radius.sm, marginHorizontal: -8, paddingHorizontal: 8 },
  listLabel: { fontSize: 16, fontWeight: '500' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 20 },
  textBtn: {
    minWidth: 64,
    height: 40,
    borderRadius: 20,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textBtnLabel: { fontSize: 14, fontWeight: '600', letterSpacing: 0.1 },
});
