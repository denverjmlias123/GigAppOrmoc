import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAppTheme, useResponsiveLayout } from '../theme';
import { useAuth } from '../../hooks/useAuth';
import { profileService, PortfolioItem } from '../../services/profile';
import { Button } from '../../components/ui/Button';
import { Card, AlertBox, PageHeaderBox } from '../../components/ui/Card';
import { TextInput } from '../../components/ui/TextInput';
import { EmptyState } from '../../components/ui/EmptyState';
import { showToast } from '../../components/ui/Toast';
import { confirmDialog } from '../../lib/dialog';
import { strings } from '../../constants/strings';

export default function PortfolioScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { isWide, bottomPad } = useResponsiveLayout();
  const { user, profile } = useAuth();
  const isHire = profile?.active_mode === 'hire';

  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([]);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPortfolio = async () => {
    if (!user || isHire) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await profileService.getPortfolioItems(user.id);
      setItems(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load portfolio items.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPortfolio();
  }, [user]);

  const handlePickPhotos = async () => {
    if (!user || uploadingPhotos) return;
    const remaining = 3 - uploadedUrls.length;
    if (remaining <= 0) {
      setError('You can attach up to 3 photos per portfolio item.');
      return;
    }
    setError(null);
    setUploadingPhotos(true);
    try {
      const urls = await profileService.pickAndUploadPortfolioImages(user.id, remaining);
      if (urls.length > 0) {
        setUploadedUrls((prev) => [...prev, ...urls].slice(0, 3));
      }
    } catch (err: any) {
      setError(err?.message || 'Could not upload portfolio photo.');
    } finally {
      setUploadingPhotos(false);
    }
  };

  const handleRemoveUploadedPhoto = (urlToRemove: string) => {
    setUploadedUrls((prev) => prev.filter((u) => u !== urlToRemove));
  };

  const handleAddItem = async () => {
    if (!user || submitting) return;
    setError(null);

    if (!title.trim()) {
      setError('Project title is required.');
      return;
    }

    setSubmitting(true);
    try {
      const newItem = await profileService.addPortfolioItem({
        profileId: user.id,
        title: title.trim(),
        description: description.trim(),
        filePaths: uploadedUrls,
      });

      setItems((prev) => [newItem, ...prev]);
      setTitle('');
      setDescription('');
      setUploadedUrls([]);
      setShowAddForm(false);
      showToast(strings.toasts.portfolioAdded);
    } catch (err: any) {
      setError(err?.message || 'Could not add portfolio item.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteItem = async (id: string) => {
    if (!user) return;
    const confirmed = await confirmDialog({
      title: 'Remove Item',
      message: 'Are you sure you want to remove this item from your portfolio?',
      confirmText: 'Remove',
      cancelText: 'Cancel',
      destructive: true,
    });
    if (!confirmed) return;

    setDeletingId(id);
    try {
      await profileService.deletePortfolioItem(id, user.id);
      setItems((prev) => prev.filter((item) => item.id !== id));
      showToast(strings.toasts.portfolioRemoved);
    } catch (err: any) {
      showToast(err?.message || 'Could not delete item.', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/profile');
    }
  };

  if (isHire) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <PageHeaderBox
          title="Freelancer Mode Only"
          subtitle="You are currently in Hire Someone (Client) mode. Clients set their hiring details and interests in Edit Profile instead."
          onBack={handleBack}
          maxWidth={920}
        />
        <View style={[styles.innerWrap, { paddingTop: 20 }]}>
          <Card tone="raised" padding="lg">
            <Button
              title="Edit Client Hiring Details"
              variant="primary"
              onPress={() => router.replace('/profile/edit')}
            />
          </Card>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <PageHeaderBox
        title="Portfolio"
        subtitle="Showcase your past projects and credentials"
        onBack={handleBack}
        maxWidth={920}
        rightAction={
          <Button
            title={showAddForm ? 'Cancel' : '+ Add Item'}
            variant={showAddForm ? 'secondary' : 'primary'}
            size="sm"
            fullWidth={false}
            onPress={() => setShowAddForm(!showAddForm)}
          />
        }
      />

      <View style={styles.innerWrap}>
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(bottomPad, 40) },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {error && <AlertBox tone="danger" message={error} style={{ marginBottom: 16 }} />}

          {showAddForm && (
            <Card tone="raised" padding="lg" style={styles.formCard}>
              <Text style={[styles.formTitle, { color: theme.colors.text }]}>New Portfolio Item</Text>

              <TextInput
                label="Project Title *"
                value={title}
                onChangeText={setTitle}
                placeholder="e.g. Logo Design for Ormoc Cafe"
              />

              <TextInput
                label="Description"
                value={description}
                onChangeText={setDescription}
                placeholder="Explain the work done, tools used, or results..."
                multiline
                numberOfLines={3}
              />

              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: theme.colors.text }]}>
                  Photos (up to 3 images, JPEG/PNG/WebP, max 5 MB)
                </Text>
                {uploadedUrls.length > 0 ? (
                  <View style={styles.previewGrid}>
                    {uploadedUrls.map((url) => (
                      <View key={url} style={styles.previewWrap}>
                        <Image source={{ uri: url }} style={styles.previewImg} />
                        <TouchableOpacity
                          style={[styles.removePhotoBadge, { backgroundColor: theme.colors.danger }]}
                          hitSlop={{ top: 13, bottom: 13, left: 13, right: 13 }}
                          accessibilityRole="button"
                          accessibilityLabel="Remove photo"
                          onPress={() => handleRemoveUploadedPhoto(url)}
                        >
                          <Ionicons name="close" size={14} color={theme.colors.primaryContrast} />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                ) : null}

                {uploadedUrls.length < 3 ? (
                  <Button
                    title={`Choose from photos/files (${uploadedUrls.length}/3)`}
                    variant="secondary"
                    icon="images-outline"
                    onPress={handlePickPhotos}
                    disabled={uploadingPhotos}
                    loading={uploadingPhotos}
                  />
                ) : null}
              </View>

              <Button
                title="Publish to Portfolio"
                variant="primary"
                icon="cloud-upload-outline"
                onPress={handleAddItem}
                disabled={submitting || uploadingPhotos}
                loading={submitting}
              />
            </Card>
          )}

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={theme.colors.primary} />
            </View>
          ) : items.length === 0 && !showAddForm ? (
            <EmptyState
              icon="images-outline"
              title="No portfolio items yet"
              description="Showcase past client work, projects, or credentials to stand out to clients in Ormoc."
              actionLabel="+ Add First Item"
              onAction={() => setShowAddForm(true)}
            />
          ) : (
            <View style={[styles.itemsList, isWide && styles.itemsListGrid]}>
              {items.map((item) => (
                <Card
                  key={item.id}
                  tone="raised"
                  padding="md"
                  style={isWide ? styles.itemCardGrid : undefined}
                >
                  <View style={styles.itemHeader}>
                    <Text style={[styles.itemTitle, { color: theme.colors.text }]}>{item.title}</Text>
                    <Button
                      title="Delete"
                      variant="danger-soft"
                      size="xs"
                      fullWidth={false}
                      loading={deletingId === item.id}
                      disabled={deletingId === item.id}
                      onPress={() => handleDeleteItem(item.id)}
                    />
                  </View>
                  {item.description ? (
                    <Text style={[styles.itemDesc, { color: theme.colors.muted }]}>
                      {item.description}
                    </Text>
                  ) : null}
                  {item.file_paths && item.file_paths.length > 0 ? (
                    <View style={styles.imagesRow}>
                      {item.file_paths.map((f, idx) => (
                        <Image key={idx} source={{ uri: f }} style={styles.itemThumb} />
                      ))}
                    </View>
                  ) : null}
                </Card>
              ))}
            </View>
          )}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  innerWrap: {
    flex: 1,
    maxWidth: 1120,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: 20,
  },
  scrollContent: {
    paddingTop: 20,
    paddingBottom: 40,
  },
  formCard: {
    marginBottom: 20,
  },
  formTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  inputGroup: {
    marginBottom: 14,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  previewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 10,
  },
  previewWrap: {
    position: 'relative',
    width: 76,
    height: 76,
  },
  previewImg: {
    width: 76,
    height: 76,
    borderRadius: 10,
  },
  removePhotoBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  itemsList: {
    gap: 12,
  },
  itemsListGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  itemCardGrid: {
    width: '48.8%',
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  itemDesc: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },
  imagesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  itemThumb: {
    width: 84,
    height: 84,
    borderRadius: 10,
  },
});
