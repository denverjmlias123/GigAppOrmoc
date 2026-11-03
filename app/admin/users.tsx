import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAppTheme, useResponsiveLayout } from '../theme';
import { adminService, AdminUser } from '../../services/admin';
import { strings, mapSqlErrorToFriendlyMessage } from '../../constants/strings';
import { TextInput } from '../../components/ui/TextInput';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { Badge } from '../../components/ui/Badge';
import { ErrorState } from '../../components/ui/ErrorState';

export default function AdminUsers() {
  const theme = useAppTheme();
  const { isWide } = useResponsiveLayout();
  const router = useRouter();
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [status, setStatus] = useState('');
  const [mode, setMode] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (nextPage = 1) => {
      setLoading(true);
      setError(null);
      try {
        const result = await adminService.listUsers({
          search: appliedSearch,
          status,
          mode,
          page: nextPage,
        });
        setRows(result.rows);
        setPage(result.page);
        setTotal(result.total_count);
      } catch (e) {
        setError(mapSqlErrorToFriendlyMessage(e, strings.errors.serverError));
      } finally {
        setLoading(false);
      }
    },
    [appliedSearch, status, mode]
  );

  useEffect(() => {
    void load(1);
  }, [load]);

  if (error && rows.length === 0) return <ErrorState message={error} onRetry={() => load(page)} />;

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.innerWrap}>
        <View style={styles.headerRow}>
          <Text style={[theme.type.title, { color: theme.colors.text }]}>{strings.admin.users}</Text>
          <Button
            title={strings.admin.createUser}
            icon="person-add-outline"
            size="sm"
            fullWidth={false}
            onPress={() => router.push('/admin/users/create')}
          />
        </View>

        <View style={styles.searchRow}>
          <View style={{ flex: 1 }}>
            <TextInput
              label={strings.admin.search}
              value={searchInput}
              onChangeText={setSearchInput}
              autoCapitalize="none"
              leftIcon="search-outline"
              returnKeyType="search"
              onSubmitEditing={() => setAppliedSearch(searchInput.trim())}
            />
          </View>
          {searchInput.trim() !== appliedSearch ? (
            <Button
              title="Search"
              size="sm"
              fullWidth={false}
              onPress={() => setAppliedSearch(searchInput.trim())}
            />
          ) : null}
        </View>

        <View style={styles.filters}>
          {[
            ['', 'All'],
            ['active', strings.admin.active],
            ['suspended', strings.admin.suspended],
            ['deleted', strings.admin.deleted],
          ].map(([value, label]) => (
            <Chip
              key={value || 'all-status'}
              label={label}
              selected={status === value}
              size="sm"
              onPress={() => setStatus(value)}
            />
          ))}
        </View>

        <View style={styles.filters}>
          {[
            ['', 'All modes'],
            ['find_work', strings.admin.findWork],
            ['hire', strings.admin.hire],
            ['unselected', strings.admin.unselected],
          ].map(([value, label]) => (
            <Chip
              key={value || 'all-mode'}
              label={label}
              selected={mode === value}
              size="sm"
              onPress={() => setMode(value)}
            />
          ))}
        </View>

        {error ? <ErrorState message={error} onRetry={() => load(page)} /> : null}
        {!loading && rows.length === 0 ? (
          <Text style={[theme.type.body, { color: theme.colors.muted }]}>
            {strings.admin.noUsers}
          </Text>
        ) : null}

        {isWide && rows.length > 0 ? (
          <View style={[styles.tableHeader, { borderColor: theme.colors.border }]}>
            <Text style={[styles.colHeader, { flex: 2.2, color: theme.colors.muted }]}>User</Text>
            <Text style={[styles.colHeader, { flex: 1.5, color: theme.colors.muted }]}>
              Mode & Role
            </Text>
            <Text style={[styles.colHeader, { flex: 1, color: theme.colors.muted }]}>Status</Text>
            <Text style={[styles.colHeader, { flex: 1.6, color: theme.colors.muted }]}>
              Created / Last Sign-In
            </Text>
          </View>
        ) : null}

        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const isSuperAdmin = item.admin_role === 'super_admin';
            const modeLabel = isSuperAdmin
              ? 'Platform Admin'
              : item.active_mode === 'hire'
              ? strings.admin.hire
              : item.active_mode === 'find_work'
              ? strings.admin.findWork
              : strings.admin.unselected;

            return (
              <Card
                tone="raised"
                padding="md"
                onPress={() =>
                  router.push({ pathname: '/admin/users/[id]', params: { id: item.id } })
                }
              >
                {isWide ? (
                  <View style={styles.tableRow}>
                    <View style={{ flex: 2.2 }}>
                      <Text style={[theme.type.bodyStrong, { color: theme.colors.text }]}>
                        {item.display_name}
                      </Text>
                      <Text style={[theme.type.small, { color: theme.colors.muted }]}>
                        {item.email}
                      </Text>
                    </View>
                    <View style={{ flex: 1.5 }}>
                      <Text style={[theme.type.small, { color: isSuperAdmin ? theme.colors.primary : theme.colors.text, fontWeight: isSuperAdmin ? '700' : '400' }]}>
                        {modeLabel}
                      </Text>
                      <Text style={[theme.type.small, { color: isSuperAdmin ? theme.colors.primary : theme.colors.muted }]}>
                        {isSuperAdmin ? strings.admin.superAdmin : strings.admin.userRole}
                      </Text>
                    </View>
                    <View style={{ flex: 1, alignItems: 'flex-start' }}>
                      <Badge status={item.status} label={item.status} />
                    </View>
                    <View style={{ flex: 1.6 }}>
                      <Text style={[theme.type.small, { color: theme.colors.muted }]}>
                        {new Date(item.created_at).toLocaleDateString()} ·{' '}
                        {item.last_sign_in_at
                          ? new Date(item.last_sign_in_at).toLocaleDateString()
                          : 'No sign in yet'}
                      </Text>
                    </View>
                  </View>
                ) : (
                  <View style={{ gap: 4 }}>
                    <View style={styles.mobileCardTop}>
                      <Text style={[theme.type.bodyStrong, { color: theme.colors.text }]}>
                        {item.display_name}
                      </Text>
                      <Badge status={item.status} label={item.status} />
                    </View>
                    <Text style={[theme.type.small, { color: theme.colors.muted }]}>
                      {item.email}
                    </Text>
                    <Text style={[theme.type.small, { color: theme.colors.muted }]}>
                      {modeLabel} · {item.status} · {isSuperAdmin ? strings.admin.superAdmin : strings.admin.userRole}
                    </Text>
                    <Text style={[theme.type.small, { color: theme.colors.muted }]}>
                      {new Date(item.created_at).toLocaleDateString()} ·{' '}
                      {item.last_sign_in_at
                        ? new Date(item.last_sign_in_at).toLocaleDateString()
                        : 'No sign in yet'}
                    </Text>
                  </View>
                )}
              </Card>
            );
          }}
        />

        <View style={styles.pagination}>
          <Button
            title="Previous"
            variant="secondary"
            size="sm"
            fullWidth={false}
            disabled={page <= 1 || loading}
            onPress={() => load(page - 1)}
          />
          <Text style={[theme.type.small, { color: theme.colors.muted, fontVariant: ['tabular-nums'] }]}>
            {page} / {Math.max(1, Math.ceil(total / 25))} · {total}
          </Text>
          <Button
            title="Next"
            variant="secondary"
            size="sm"
            fullWidth={false}
            disabled={loading || page * 25 >= total}
            onPress={() => load(page + 1)}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 18 },
  innerWrap: {
    flex: 1,
    maxWidth: 1120,
    width: '100%',
    alignSelf: 'center',
    gap: 10,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 10,
  },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tableHeader: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  colHeader: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  mobileCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  list: { gap: 8 },
  pagination: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
});
