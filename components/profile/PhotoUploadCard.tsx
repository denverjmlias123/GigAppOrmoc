import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
} from 'react-native';
import { useAppTheme } from '../../app/theme';
import { Avatar } from '../ui/Avatar';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { strings } from '../../constants/strings';

interface PhotoUploadCardProps {
  displayName: string;
  avatarPath?: string | null;
  photoBusy: boolean;
  onPickLibrary: () => void;
  onPickCamera: () => void;
  onRemovePhoto?: () => void;
}

export const PhotoUploadCard: React.FC<PhotoUploadCardProps> = ({
  displayName,
  avatarPath,
  photoBusy,
  onPickLibrary,
  onPickCamera,
  onRemovePhoto,
}) => {
  const theme = useAppTheme();

  return (
    <Card
      headerTitle={strings.profile.photoSectionTitle}
      headerSubtitle="Add a clear photo to help local clients and freelancers recognize you."
      headerIcon="camera-outline"
      style={styles.photoCard}
    >
      <View style={styles.photoRow}>
        <Avatar
          name={displayName}
          imageUri={avatarPath}
          size={76}
          editable
          onPress={onPickLibrary}
        />
        <View style={styles.photoActions}>
          <Button
            title={photoBusy ? 'Uploading...' : strings.profile.chooseFromLibraryBtn}
            onPress={onPickLibrary}
            variant="primary"
            size="sm"
            icon="images-outline"
            loading={photoBusy}
            disabled={photoBusy}
          />

          {Platform.OS !== 'web' ? (
            <Button
              title={strings.profile.takePhotoBtn}
              onPress={onPickCamera}
              variant="secondary"
              size="sm"
              icon="camera-outline"
              disabled={photoBusy}
            />
          ) : null}

          {avatarPath && onRemovePhoto ? (
            <Button
              title={strings.profile.removePhotoBtn}
              onPress={onRemovePhoto}
              variant="danger-soft"
              size="sm"
              icon="trash-outline"
              disabled={photoBusy}
            />
          ) : null}
        </View>
      </View>
      <Text style={[styles.helperText, { color: theme.colors.muted, marginTop: 12 }]}>
        Square crop recommended. Supported formats: JPEG, PNG, or WebP up to 5 MB.
      </Text>
    </Card>
  );
};

const styles = StyleSheet.create({
  photoCard: {
    marginBottom: 16,
  },
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  photoActions: {
    flex: 1,
    maxWidth: 260,
    gap: 8,
  },
  helperText: {
    fontSize: 12,
    lineHeight: 16,
  },
});
