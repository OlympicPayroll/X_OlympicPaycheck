import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { usePhoto, useUploadPhoto } from '@/api/queries';
import { FamilyHeader, PageTitle } from '@/components/app-bar';
import { ChevronRight } from '@/components/icons';
import { Illustration } from '@/components/illustrations';
import { Button } from '@/components/ui';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { clearCredential, getCapability, hasSavedCredential, type BiometricCapability } from '@/lib/biometrics';
import { useDialog } from '@/lib/dialog';
import { displayName } from '@/lib/format';
import { choosePhoto, takePhoto } from '@/lib/photo';
import { clearRememberedEmail } from '@/lib/prefs';
import { useSession } from '@/lib/session';

export default function ProfileScreen() {
  const theme = useTheme();
  const { confirm, choose } = useDialog();
  const { session, company, endSession } = useSession();
  const { data: photoUri } = usePhoto();
  const uploadPhoto = useUploadPhoto();

  const [capability, setCapability] = useState<BiometricCapability | null>(null);
  const [biometricOn, setBiometricOn] = useState(false);

  const refreshBiometrics = useCallback(async () => {
    const [cap, enrolled] = await Promise.all([getCapability(), hasSavedCredential()]);
    setCapability(cap);
    setBiometricOn(enrolled);
  }, []);

  useEffect(() => {
    refreshBiometrics();
  }, [refreshBiometrics]);

  const onChangePhoto = async () => {
    const pick = await choose({
      title: photoUri ? 'Change profile photo' : 'Add profile photo',
      options: ['Take Photo', 'Choose from Library'],
    });
    if (pick === null) return;

    const result = pick === 0 ? await takePhoto() : await choosePhoto();

    if ('error' in result) {
      if (result.error === 'cancelled') return;
      await confirm({
        title: result.error === 'denied' ? 'Permission needed' : 'Couldn’t use that photo',
        message:
          result.error === 'denied'
            ? `Allow Olympic Paycheck to use your ${pick === 0 ? 'camera' : 'photos'} in your phone’s Settings.`
            : 'Please try a different photo.',
        confirmText: 'OK',
        cancelText: 'Close',
      });
      return;
    }

    uploadPhoto.mutate(
      { base64: result.base64 },
      {
        onError: () =>
          confirm({
            title: 'Upload failed',
            message: 'We couldn’t save your photo. Check your connection and try again.',
            confirmText: 'OK',
            cancelText: 'Close',
          }),
      },
    );
  };

  /**
   * Only turning it OFF happens here. Turning it on requires the SSN, which we
   * deliberately don't keep in memory — so it's offered right after sign-in.
   */
  const onToggleBiometric = async (next: boolean) => {
    if (next) {
      await confirm({
        title: `Turn on ${capability?.label ?? 'biometrics'}`,
        message: `Sign out and sign in again — we’ll offer to enable ${capability?.label ?? 'biometrics'} right after.`,
        confirmText: 'Got it',
        cancelText: 'Close',
      });
      return;
    }
    const ok = await confirm({
      title: `Turn off ${capability?.label ?? 'biometrics'}?`,
      message: 'Your saved sign-in will be erased from this device.',
      confirmText: 'Turn Off',
      destructive: true,
    });
    if (!ok) return;
    await clearCredential();
    setBiometricOn(false);
  };

  const onSignOut = async () => {
    const ok = await confirm({
      title: 'Sign out?',
      message: 'You’ll need your email and SSN to sign back in.',
      confirmText: 'Sign Out',
      destructive: true,
    });
    if (!ok) return;
    await Promise.all([clearCredential(), clearRememberedEmail()]);
    endSession();
    router.replace('/');
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.ground }}>
      <FamilyHeader />

      <ScrollView contentContainerStyle={styles.content}>
        <PageTitle title="My Profile" />

        <Animated.View entering={FadeInDown.duration(300).delay(60)} style={styles.photoBlock}>
          <Pressable onPress={onChangePhoto} accessibilityRole="button" accessibilityLabel="Change profile photo">
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.photo} contentFit="cover" />
            ) : (
              <Illustration name="camera" size={84} />
            )}
            {uploadPhoto.isPending && (
              <View style={[styles.photoBusy, { backgroundColor: theme.rowFill }]}>
                <ActivityIndicator color={theme.brand} />
              </View>
            )}
          </Pressable>

          <Text style={[Type.headline, { color: theme.ink, marginTop: Spacing.two }]}>
            {session ? displayName(session.employee.fullName) : ''}
          </Text>
          <Text style={[Type.caption, { color: theme.textSecondary, marginTop: 2 }]}>{company?.name ?? ''}</Text>

          <Button
            title={photoUri ? 'Change Profile Photo' : 'Add Profile Photo'}
            variant="subtle"
            onPress={onChangePhoto}
            loading={uploadPhoto.isPending}
            style={{ alignSelf: 'stretch', marginTop: Spacing.three }}
          />
          <Text style={[Type.caption, { color: theme.faint, marginTop: Spacing.two, textAlign: 'center' }]}>
            Your photo appears on your pay stubs in this app.
          </Text>
        </Animated.View>

        <View style={styles.rows}>
          {capability?.available && (
            <View style={[styles.row, { backgroundColor: theme.rowFill }]}>
              <View style={{ flex: 1 }}>
                <Text style={[Type.row, { color: theme.ink, fontSize: 17 }]}>Sign in with {capability.label}</Text>
                <Text style={[Type.caption, { color: theme.textSecondary, marginTop: 2 }]}>
                  {biometricOn ? 'Enabled on this device' : 'Not set up'}
                </Text>
              </View>
              <Switch
                value={biometricOn}
                onValueChange={onToggleBiometric}
                trackColor={{ true: theme.moneyBright, false: theme.line }}
                thumbColor="#fff"
              />
            </View>
          )}

          {session && session.companies.length > 1 && (
            <ProfileRow label="Switch employer" onPress={() => router.push('/companies')} />
          )}
          <ProfileRow label="Privacy Policy" onPress={() => router.push('/legal?doc=privacy')} />
          <ProfileRow label="Terms of Use" onPress={() => router.push('/legal?doc=terms')} />
          <ProfileRow label="Sign Out" danger onPress={onSignOut} />
        </View>
      </ScrollView>
    </View>
  );
}

/** Rounded light-gray row, echoing the family's profile checklist. */
function ProfileRow({ label, danger, onPress }: { label: string; danger?: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, { backgroundColor: theme.rowFill }, pressed && { opacity: 0.7 }]}
    >
      <Text style={[Type.row, { color: danger ? theme.danger : theme.ink, fontSize: 17, flex: 1 }]}>{label}</Text>
      <ChevronRight color={theme.faint} size={19} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 140 },
  photoBlock: { alignItems: 'center', paddingHorizontal: Spacing.three, marginTop: Spacing.two },
  photo: { width: 104, height: 104, borderRadius: 52 },
  photoBusy: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 52,
    opacity: 0.85,
  },
  rows: { gap: 12, paddingHorizontal: Spacing.three, marginTop: Spacing.four },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 17,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.md,
  },
});
