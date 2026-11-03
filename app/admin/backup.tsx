import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Platform, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useAppTheme, useResponsiveLayout } from '../theme';
import { adminService, BackupRecord } from '../../services/admin';
import { strings, mapSqlErrorToFriendlyMessage } from '../../constants/strings';
import { Button } from '../../components/ui/Button';
import { Card, AlertBox } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { ErrorState } from '../../components/ui/ErrorState';
import { confirmDialog } from '../../lib/dialog';
import { showToast } from '../../components/ui/Toast';

export default function AdminBackupScreen() {
  const theme = useAppTheme();
  const { isDesktop } = useResponsiveLayout();
  const router = useRouter();
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadBackups = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminService.listBackups();
      setBackups(data);
    } catch (e: any) {
      setError(mapSqlErrorToFriendlyMessage(e, 'Failed to load database backups.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBackups();
  }, [loadBackups]);

  const handleCreateBackup = async () => {
    if (creating) return;
    const confirmed = await confirmDialog({
      title: 'Create Database Backup',
      message: 'This will take an atomic snapshot of all tables, schema integrity, and security audit records.',
      confirmText: 'Create Backup',
      cancelText: 'Cancel',
    });
    if (!confirmed) return;

    setCreating(true);
    setError(null);
    try {
      const res = await adminService.createBackup('manual');
      showToast(`Backup created: ${res.record_count} records saved.`);
      await loadBackups();
    } catch (e: any) {
      setError(mapSqlErrorToFriendlyMessage(e, 'Failed to create database backup.'));
    } finally {
      setCreating(false);
    }
  };

  const handleRestoreBackup = async (item: BackupRecord) => {
    if (restoringId) return;
    const confirmed = await confirmDialog({
      title: 'Restore Database from Backup',
      message: `Restore state to backup taken on ${new Date(item.created_at).toLocaleString()} (${item.record_count} records)? This action is audited.`,
      confirmText: 'Restore Now',
      cancelText: 'Cancel',
      destructive: true,
    });
    if (!confirmed) return;

    setRestoringId(item.id);
    setError(null);
    try {
      await adminService.restoreBackup(item.id);
      showToast('Database restore completed successfully.');
      await loadBackups();
    } catch (e: any) {
      setError(mapSqlErrorToFriendlyMessage(e, 'Failed to restore backup.'));
    } finally {
      setRestoringId(null);
    }
  };

  const handleDownloadBackup = async (item: BackupRecord) => {
    if (exportingId) return;
    setExportingId(item.id);
    try {
      const snapshot = await adminService.getBackupSnapshot(item.id);
      const jsonStr = JSON.stringify(snapshot, null, 2);
      const filename = `gigormoc-backup-${item.id.slice(0, 8)}.json`;

      if (Platform.OS === 'web') {
        const anchor = document.createElement('a');
        anchor.href = `data:application/json;charset=utf-8,${encodeURIComponent(jsonStr)}`;
        anchor.download = filename;
        anchor.click();
      } else {
        const fileUri = `${FileSystem.cacheDirectory || FileSystem.documentDirectory}${filename}`;
        await FileSystem.writeAsStringAsync(fileUri, jsonStr, { encoding: FileSystem.EncodingType.UTF8 });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(fileUri, {
            mimeType: 'application/json',
            dialogTitle: 'Download Database Backup',
            UTI: 'public.json',
          });
        }
      }
      showToast('Backup downloaded successfully.');
    } catch (e: any) {
      setError(mapSqlErrorToFriendlyMessage(e, 'Failed to download backup snapshot.'));
    } finally {
      setExportingId(null);
    }
  };

  const renderItem = ({ item }: { item: BackupRecord }) => {
    const isRestoring = restoringId === item.id;
    const isExporting = exportingId === item.id;

    return (
      <Card tone="raised" padding="md" style={styles.backupCard}>
        <View style={styles.cardHeader}>
          <View style={styles.titleInfo}>
            <View style={styles.badgeRow}>
              <Badge
                status={item.status === 'completed' ? 'approved' : item.status === 'restored' ? 'active' : 'pending'}
                label={item.status.toUpperCase()}
              />
              <Badge
                status={item.backup_type === 'scheduled' ? 'active' : 'draft'}
                label={item.backup_type === 'scheduled' ? 'AUTOMATED' : 'MANUAL'}
              />
            </View>
            <Text style={[theme.type.bodyStrong, { color: theme.colors.text, marginTop: 4 }]}>
              {new Date(item.created_at).toLocaleString()}
            </Text>
            <Text style={[theme.type.small, { color: theme.colors.muted }]}>
              Created by: {item.creator_email || 'System Scheduler'}
            </Text>
          </View>

          <View style={styles.countBadge}>
            <Text style={[styles.countNumber, { color: theme.colors.primary }]}>
              {item.record_count.toLocaleString()}
            </Text>
            <Text style={[styles.countLabel, { color: theme.colors.muted }]}>Records</Text>
          </View>
        </View>

        <View style={styles.detailsRow}>
          <Text style={[theme.type.small, { color: theme.colors.muted }]}>
            Checksum: <Text style={{ fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' }}>{item.checksum ? item.checksum.slice(0, 16) : 'N/A'}</Text>
          </Text>
          {item.restored_at ? (
            <Text style={[theme.type.small, { color: theme.colors.primary }]}>
              Restored: {new Date(item.restored_at).toLocaleString()}
            </Text>
          ) : null}
        </View>

        <Text style={[theme.type.small, { color: theme.colors.muted }]}>
          Tables: {(item.tables_included || []).join(', ')}
        </Text>

        <View style={styles.cardActions}>
          <Button
            title={isExporting ? 'Downloading...' : 'Download JSON'}
            variant="secondary"
            size="sm"
            icon="download-outline"
            onPress={() => handleDownloadBackup(item)}
            loading={isExporting}
            disabled={isExporting || isRestoring}
            fullWidth={false}
          />
          <Button
            title={isRestoring ? 'Restoring...' : 'Restore'}
            variant="danger"
            size="sm"
            icon="refresh-circle-outline"
            onPress={() => handleRestoreBackup(item)}
            loading={isRestoring}
            disabled={isExporting || isRestoring}
            fullWidth={false}
          />
        </View>
      </Card>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.innerWrap}>
        <View style={styles.headerRow}>
          <View>
            <Text style={[theme.type.title, { color: theme.colors.text }]}>
              Database Backup & Recovery
            </Text>
            <Text style={[theme.type.body, { color: theme.colors.muted }]}>
              IAS 1 Requirement H: Scheduled and on-demand database snapshots
            </Text>
          </View>

          <Button
            title={creating ? 'Backing Up...' : 'Create Backup'}
            icon="cloud-upload-outline"
            size="sm"
            onPress={handleCreateBackup}
            loading={creating}
            disabled={creating || loading}
            fullWidth={false}
          />
        </View>

        <Card tone="tinted-primary" padding="md" style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Ionicons name="time-outline" size={24} color={theme.colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[theme.type.bodyStrong, { color: theme.colors.text }]}>
                Automated Schedule: Daily at 00:00 UTC
              </Text>
              <Text style={[theme.type.small, { color: theme.colors.muted }]}>
                Snapshots include all core entities (profiles, gigs, agreements, milestones, and audit logs) with cryptographic integrity verification.
              </Text>
            </View>
          </View>
        </Card>

        {error ? <AlertBox tone="danger" message={error} style={{ marginBottom: 16 }} /> : null}

        {loading && backups.length === 0 ? (
          <Text style={[theme.type.body, { color: theme.colors.muted, textAlign: 'center', marginTop: 40 }]}>
            Loading backups...
          </Text>
        ) : (
          <FlatList
            data={backups}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <Card tone="outline" padding="lg" style={{ alignItems: 'center' }}>
                <Ionicons name="archive-outline" size={36} color={theme.colors.muted} />
                <Text style={[theme.type.bodyStrong, { color: theme.colors.text, marginTop: 12 }]}>
                  No backups created yet
                </Text>
                <Text style={[theme.type.body, { color: theme.colors.muted, textAlign: 'center', marginTop: 4 }]}>
                  Click "Create Backup" above to generate your first database snapshot.
                </Text>
              </Card>
            }
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  innerWrap: { flex: 1, width: '100%', maxWidth: 1120, alignSelf: 'center', padding: 16 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    flexWrap: 'wrap',
    gap: 12,
  },
  infoCard: { marginBottom: 16 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  listContent: { gap: 14, paddingBottom: 32 },
  backupCard: { gap: 10, borderRadius: 16 },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  titleInfo: { flex: 1 },
  badgeRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  countBadge: {
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(59, 130, 246, 0.08)',
  },
  countNumber: { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  countLabel: { fontSize: 11, fontWeight: '600' },
  detailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
    marginTop: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(148, 163, 184, 0.15)',
  },
});
