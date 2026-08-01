import * as ImagePicker from 'expo-image-picker';

/**
 * Profile photo capture.
 *
 * Images are squared, downscaled and returned as base64 because the payroll
 * service stores photos as base64 strings (the legacy `InsertBase64Photo`
 * call). Keeping quality modest matters: a full-resolution phone photo is
 * several megabytes as base64 and would time out on a slow connection.
 */

export type PickResult = { base64: string } | { error: 'denied' | 'cancelled' | 'failed' };

const OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: true,
  aspect: [1, 1],
  quality: 0.6,
  base64: true,
};

function toResult(response: ImagePicker.ImagePickerResult): PickResult {
  if (response.canceled) return { error: 'cancelled' };
  const base64 = response.assets?.[0]?.base64;
  return base64 ? { base64 } : { error: 'failed' };
}

/** Take a new photo with the camera. */
export async function takePhoto(): Promise<PickResult> {
  try {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { error: 'denied' };
    return toResult(await ImagePicker.launchCameraAsync(OPTIONS));
  } catch {
    return { error: 'failed' };
  }
}

/** Choose an existing photo from the library. */
export async function choosePhoto(): Promise<PickResult> {
  try {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return { error: 'denied' };
    return toResult(await ImagePicker.launchImageLibraryAsync(OPTIONS));
  } catch {
    return { error: 'failed' };
  }
}
