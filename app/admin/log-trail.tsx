import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useAppTheme, useResponsiveLayout } from '../theme';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { ErrorState } from '../../components/ui/ErrorState';
import { TextInput } from '../../components/ui/TextInput';
import { showToast } from '../../components/ui/Toast';
import { strings } from '../../constants/strings';
import { adminService, AuditEvent, AuditFilters } from '../../services/admin';

const PAGE_SIZE = 25;
const CSV_COLUMNS = [
  ['created_at', strings.admin.logOccurredAt],
  ['actor_email', strings.admin.logActor],
  ['actor_role', strings.admin.logRole],
  ['action', strings.admin.logActionLabel],
  ['status', strings.admin.logStatusLabel],
  ['entity_type', strings.admin.logEntity],
  ['entity_id', strings.admin.logEntityId],
  ['ip', strings.admin.logIp],
  ['device', strings.admin.logDevice],
  ['metadata', strings.admin.logMetadata],
] as const;

function csvCell(value: unknown): string {
  const text = typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function formatLogDate(dateStr?: string | null): string {
  if (!dateStr) return strings.admin.logNoValue;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? strings.admin.logNoValue : d.toLocaleString('en-PH');
}

function makeCsv(rows: AuditEvent[]): string {
  const header = CSV_COLUMNS.map(([, title]) => csvCell(title)).join(',');
  const body = rows.map((row) => CSV_COLUMNS.map(([key]) => csvCell(row[key])).join(','));
  return [header, ...body].join('\r\n');
}

export default function AdminLogTrailScreen() {
  const theme = useAppTheme();
  const { isWide } = useResponsiveLayout();
  const [draft, setDraft] = useState<AuditFilters>({});
  const [filters, setFilters] = useState<AuditFilters>({});
  const [rows, setRows] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showFiltersMobile, setShowFiltersMobile] = useState(false);

  const loadPage = useCallback(async (currentFilters: AuditFilters, currentPage: number) => {
    setLoading(true);
    setError(null);
    setExpandedId(null);
    try {
      const result = await adminService.getLogTrail(currentFilters, currentPage, PAGE_SIZE);
      setRows(result.rows);
      setTotal(result.total_count);
      setPage(result.page);
    } catch (cause: any) {
      const denied = String(cause?.message || '').includes('admin_required') || cause?.code === '42501';
      const invalidFilter = String(cause?.message || '').startsWith('invalid_') || String(cause?.message || '').includes('date/time');
      setError(denied ? strings.admin.logAccessDenied : invalidFilter ? strings.admin.logFilterBoundary : strings.admin.logLoadFailed);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPage(filters, page);
  }, [filters, page, loadPage]);

  const setFilter = (key: keyof AuditFilters, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const applyFilters = () => {
    setFilters(Object.fromEntries(Object.entries(draft).filter(([, value]) => Boolean(value))) as AuditFilters);
    setPage(1);
  };

  const clearFilters = () => {
    setDraft({});
    setFilters({});
    setPage(1);
  };

  const exportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const exportRows = await adminService.exportLogTrail(filters);
      const csv = makeCsv(exportRows);
      if (Platform.OS === 'web') {
        const anchor = document.createElement('a');
        anchor.href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
        anchor.download = 'gigormoc-log-trail.csv';
        anchor.click();
      } else {
        // new File(Paths.cache, 'gigormoc-log-trail.csv') compatibility for Expo 52
        const fileUri = `${FileSystem.cacheDirectory || FileSystem.documentDirectory}gigormoc-log-trail.csv`;
        await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });
        await Sharing.shareAsync(fileUri, { mimeType: 'text/csv', dialogTitle: strings.admin.logExportTitle });
      }
      showToast(strings.admin.logExportReady(exportRows.length), 'success');
    } catch (cause: any) {
      const message = cause?.message === 'EXPORT_LIMIT'
        ? strings.admin.logExportLimit
        : cause?.message === 'EXPORT_ACTION_LIMIT' ? strings.admin.logExportViewLimit : strings.admin.logExportFailed;
      showToast(message, 'error');
    } finally {
      setExporting(false);
    }
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtersVisible = isWide || showFiltersMobile;

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={[theme.type.title, { color: theme.colors.text }]}>{strings.admin.logTitle}</Text>
          <Text style={[theme.type.body, { color: theme.colors.muted }]}>{strings.admin.logSubtitle}</Text>
        </View>
        {!isWide ? (
          <Button
            title={showFiltersMobile ? 'Hide Filters' : 'Show Filters'}
            variant="secondary"
            size="xs"
            fullWidth={false}
            icon="options-outline"
            onPress={() => setShowFiltersMobile((v) => !v)}
          />
        ) : null}
      </View>

      {filtersVisible ? (
        <Card tone="raised" padding="md">
          <View style={isWide ? styles.filterGridWide : undefined}>
            <View style={isWide ? styles.filterCellWide : undefined}>
              <TextInput
                label={strings.admin.logSearchLabel}
                value={draft.search || ''}
                onChangeText={(value) => setFilter('search', value)}
                autoCapitalize="none"
              />
            </View>
            <View style={isWide ? styles.filterCellWide : undefined}>
              <TextInput
                label={strings.admin.logUserLabel}
                value={draft.user || ''}
                onChangeText={(value) => setFilter('user', value)}
                autoCapitalize="none"
              />
            </View>
            <View style={isWide ? styles.filterCellWide : undefined}>
              <TextInput
                label={strings.admin.logActionLabel}
                value={draft.action || ''}
                onChangeText={(value) => setFilter('action', value)}
                autoCapitalize="none"
              />
            </View>
            <View style={isWide ? styles.filterCellWide : undefined}>
              <TextInput
                label={strings.admin.logEntityLabel}
                value={draft.entity || ''}
                onChangeText={(value) => setFilter('entity', value)}
                autoCapitalize="none"
              />
            </View>
            <View style={isWide ? styles.filterCellWide : undefined}>
              <TextInput
                label={strings.admin.logFromLabel}
                value={draft.date_from || ''}
                onChangeText={(value) => setFilter('date_from', value)}
                placeholder={strings.admin.logDatePlaceholder}
                autoCapitalize="none"
              />
            </View>
            <View style={isWide ? styles.filterCellWide : undefined}>
              <TextInput
                label={strings.admin.logToLabel}
                value={draft.date_to || ''}
                onChangeText={(value) => setFilter('date_to', value)}
                placeholder={strings.admin.logDatePlaceholder}
                autoCapitalize="none"
              />
            </View>
          </View>

          <Text style={[theme.type.small, styles.statusLabel, { color: theme.colors.text }]}>
            {strings.admin.logStatusLabel}
          </Text>
          <View style={styles.statusOptions}>
            {[
              ['', strings.admin.logAllStatus],
              ['success', strings.admin.logSuccessStatus],
              ['failure', strings.admin.logFailureStatus],
            ].map(([value, label]) => (
              <Chip
                key={value}
                label={label}
                selected={(draft.status || '') === value}
                size="sm"
                onPress={() => setFilter('status', value)}
              />
            ))}
          </View>

          <View style={styles.filterActionsRow}>
            <View style={{ flex: 1 }}>
              <Button title={strings.admin.logApplyFilters} onPress={applyFilters} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title={strings.admin.logClearFilters} onPress={clearFilters} variant="ghost" />
            </View>
          </View>
        </Card>
      ) : null}

      {loading ? <Text style={[theme.type.body, { color: theme.colors.muted }]}>{strings.common.loading}</Text> : null}
      {!loading && error ? <ErrorState message={error} onRetry={() => loadPage(filters, page)} /> : null}
      {!loading && !error && rows.length === 0 ? (
        <Card tone="raised" padding="md">
          <Text style={[theme.type.body, { color: theme.colors.muted }]}>{strings.admin.logEmpty}</Text>
        </Card>
      ) : null}

      {!loading && !error && rows.map((item, index) => {
        if (!item) return null;
        const actionDisplay = (item.action || strings.admin.logNoValue).replace(/_/g, ' ');
        const itemKey = item.id || `log-${index}`;
        return (
          <Card key={itemKey} tone="raised" padding="md">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${strings.admin.logEvent}: ${actionDisplay}`}
              accessibilityState={{ expanded: expandedId === item.id }}
              onPress={() => setExpandedId((current) => (current === item.id ? null : item.id))}
            >
              <View style={styles.eventHeader}>
                <Text style={[theme.type.bodyStrong, { color: theme.colors.text }]}>
                  {actionDisplay}
                </Text>
                <Text
                  style={[
                    theme.type.small,
                    {
                      color: item.status === 'failure' ? theme.colors.dangerText : theme.colors.primary,
                      fontWeight: '700',
                    },
                  ]}
                >
                  {item.status === 'failure' ? strings.admin.logFailureStatus : strings.admin.logSuccessStatus}
                </Text>
              </View>
              <Text style={[theme.type.small, { color: theme.colors.muted }]}>
                {item.actor_email || item.actor_id || strings.admin.logNoValue}: {item.entity_type || strings.admin.logNoValue}
              </Text>
              <Text style={[theme.type.small, { color: theme.colors.muted }]}>
                {formatLogDate(item.created_at)}
              </Text>
            </Pressable>
            {expandedId === item.id ? (
              <View style={[styles.details, { borderTopColor: theme.colors.border }]}>
                <Text style={[theme.type.small, { color: theme.colors.text }]}>
                  {strings.admin.logActor}: {item.actor_email || item.actor_id || strings.admin.logNoValue}
                </Text>
                <Text style={[theme.type.small, { color: theme.colors.text }]}>
                  {strings.admin.logEntity}: {item.entity_type || strings.admin.logNoValue} · {item.entity_id || strings.admin.logNoValue}
                </Text>
                <Text style={[theme.type.small, { color: theme.colors.text }]}>
                  {strings.admin.logIp}: {item.ip || strings.admin.logNoValue}
                </Text>
                <Text style={[theme.type.small, { color: theme.colors.text }]}>
                  {strings.admin.logDevice}: {item.device || strings.admin.logNoValue}
                </Text>
                <Text selectable style={[theme.type.small, { color: theme.colors.text }]}>
                  {strings.admin.logMetadata}: {JSON.stringify(item.metadata || {})}
                </Text>
              </View>
            ) : null}
          </Card>
        );
      })}

      {!loading && !error && total > 0 ? (
        <View style={styles.pagination}>
          <Button
            title={strings.admin.logPrevious}
            variant="secondary"
            size="sm"
            fullWidth={false}
            disabled={page <= 1}
            onPress={() => setPage((current) => Math.max(1, current - 1))}
          />
          <Text style={[theme.type.small, styles.pageText, { color: theme.colors.muted }]}>
            {strings.admin.logPage(page, pages, total)}
          </Text>
          <Button
            title={strings.admin.logNext}
            variant="secondary"
            size="sm"
            fullWidth={false}
            disabled={page >= pages}
            onPress={() => setPage((current) => Math.min(pages, current + 1))}
          />
          <Button
            title={exporting ? strings.admin.logExporting : strings.admin.logExport}
            variant="ghost"
            size="sm"
            fullWidth={false}
            icon="download-outline"
            disabled={exporting}
            loading={exporting}
            onPress={exportCsv}
          />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
    gap: 12,
    maxWidth: 1120,
    width: '100%',
    alignSelf: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  filterGridWide: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  filterCellWide: {
    width: '31.5%',
    minWidth: 220,
    flexGrow: 1,
  },
  filterActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  statusLabel: { marginBottom: 8 },
  statusOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  eventHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginBottom: 6 },
  details: { gap: 6, marginTop: 12, paddingTop: 12, borderTopWidth: 1 },
  pagination: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  pageText: { textAlign: 'center', paddingVertical: 8, fontVariant: ['tabular-nums'] },
});
