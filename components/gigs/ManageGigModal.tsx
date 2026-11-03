import React from 'react';
import { View, Text, StyleSheet, Modal, Pressable, Platform } from 'react-native';
import { GigDetail } from '../../services/gigs';
import { AppTheme, useResponsiveLayout } from '../../app/theme';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { strings } from '../../constants/strings';

interface ManageGigModalProps {
  visible: boolean;
  onClose: () => void;
  gig: GigDetail | null;
  theme: AppTheme;
  onEdit: () => void;
  onCancel: () => void;
  onDelete: () => void;
  publishing?: boolean;
  cancelling?: boolean;
  deleting?: boolean;
  editTitle?: string;
  cancelTitle?: string;
  deleteTitle?: string;
}

export function ManageGigModal({
  visible,
  onClose,
  gig,
  theme,
  onEdit,
  onCancel,
  onDelete,
  publishing = false,
  cancelling = false,
  deleting = false,
  editTitle = strings.gigs.editGig,
  cancelTitle = strings.gigs.cancelGigBtn,
  deleteTitle = strings.gigs.deleteGigBtn,
}: ManageGigModalProps) {
  const { isWide, bottomSpace } = useResponsiveLayout();
  if (!gig) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType={isWide ? 'fade' : 'slide'}
      onRequestClose={onClose}
    >
      <Pressable
        style={[styles.modalBackdrop, isWide && styles.modalBackdropWide]}
        onPress={onClose}
      >
        <Pressable
          style={[
            styles.sheetContainer,
            isWide ? styles.sheetContainerWide : { paddingBottom: bottomSpace },
            { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          {/* Visual Drag Handle on mobile */}
          {!isWide && (
            <View style={styles.dragHandleContainer}>
              <View style={[styles.dragHandle, { backgroundColor: theme.colors.borderStrong }]} />
            </View>
          )}

          <View style={styles.sheetHeader}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={[styles.sheetTitle, { color: theme.colors.text }]}>Manage Gig</Text>
              <Text style={[styles.sheetSubtitle, { color: theme.colors.muted }]} numberOfLines={1}>
                {gig.title}
              </Text>
            </View>
            <Badge status={gig.status} />
          </View>

          <View style={styles.sheetActionList}>
            <Button
              title={editTitle}
              variant="secondary"
              icon="pencil-outline"
              onPress={onEdit}
              disabled={publishing || cancelling || deleting}
            />

            {(gig.status === 'open' || gig.status === 'draft') && (
              <Button
                title={cancelTitle}
                variant="secondary"
                icon="close-circle-outline"
                onPress={onCancel}
                loading={cancelling}
                disabled={cancelling || deleting}
              />
            )}

            <Button
              title={deleting ? strings.gigs.deletingGig : deleteTitle}
              variant="danger"
              icon="trash-outline"
              onPress={onDelete}
              loading={deleting}
              disabled={deleting || cancelling || publishing}
            />
          </View>

          <Button
            title="Close"
            variant="ghost"
            onPress={onClose}
            style={{ marginTop: 8 }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(7, 11, 38, 0.55)',
    justifyContent: 'flex-end',
  },
  modalBackdropWide: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  sheetContainer: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    width: '100%',
  },
  sheetContainerWide: {
    maxWidth: 460,
    borderRadius: 24,
    borderWidth: 1,
    paddingBottom: 20,
    alignSelf: 'center',
  },
  dragHandleContainer: {
    alignItems: 'center',
    paddingVertical: 4,
    marginBottom: 12,
  },
  dragHandle: {
    width: 44,
    height: 5,
    borderRadius: 3,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 2,
  },
  sheetSubtitle: {
    fontSize: 13,
  },
  sheetActionList: {
    gap: 10,
  },
});

