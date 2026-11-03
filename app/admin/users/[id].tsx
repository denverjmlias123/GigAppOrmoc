import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAppTheme, useResponsiveLayout } from '../../theme';
import { useAuth } from '../../../hooks/useAuth';
import { adminService } from '../../../services/admin';
import { strings, mapSqlErrorToFriendlyMessage } from '../../../constants/strings';
import { TextInput } from '../../../components/ui/TextInput';
import { Button } from '../../../components/ui/Button';
import { Card, AlertBox, PageHeaderBox } from '../../../components/ui/Card';
import { ErrorState } from '../../../components/ui/ErrorState';
import { confirmDialog } from '../../../lib/dialog';
import { showToast } from '../../../components/ui/Toast';

export default function AdminUserDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useAppTheme();
  const { isDesktop } = useResponsiveLayout();
  const router = useRouter();
  const { user: currentUser } = useAuth();
  const [detail, setDetail] = useState<any>(null);
  const [superAdmin, setSuperAdmin] = useState(false);
  const [name, setName] = useState('');
  const [area, setArea] = useState('');
  const [status, setStatus] = useState<'active' | 'suspended'>('active');
  const [role, setRole] = useState<'user' | 'super_admin'>('user');
  const [emailConfirm, setEmailConfirm] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [row, isSuper] = await Promise.all([
        adminService.userDetail(String(id)),
        adminService.isSuperAdmin(),
      ]);
      setDetail(row);
      setName(row.profile.display_name || '');
      setArea(row.profile.area || '');
      setStatus(row.profile.status === 'suspended' ? 'suspended' : 'active');
      setRole(row.admin_role || 'user');
      setSuperAdmin(isSuper);
    } catch (e) {
      setError(mapSqlErrorToFriendlyMessage(e, strings.errors.serverError));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (actionKey: string, fn: () => Promise<any>, message = strings.toasts.adminSaved) => {
    if (activeAction) return;
    setActiveAction(actionKey);
    setError(null);
    try {
      await fn();
      showToast(message);
      await load();
    } catch (e) {
      setError(mapSqlErrorToFriendlyMessage(e, strings.errors.serverError));
    } finally {
      setActiveAction(null);
    }
  };

  if (loading && !detail) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <Text style={[theme.type.body, { color: theme.colors.text }]}>{strings.common.loading}</Text>
      </View>
    );
  }
  if (!detail) return <ErrorState message={error || strings.errors.notFound} onRetry={load} />;

  const profile = detail.profile;
  const saving = Boolean(activeAction);
  const setRoleAction = () => act('role', () => adminService.setAdminRole(String(id), role));
  const sendReset = () =>
    act(
      'reset',
      () => adminService.invokeUserAction({ action: 'send_password_reset', userId: id }),
      strings.toasts.adminResetSent
    );
  const unlock = () =>
    act('unlock', () => adminService.unlockLogin(detail.email), strings.toasts.adminUnlocked);
  const lock = () =>
    act('lock', () => adminService.lockLogin(detail.email), 'User login locked for 24 hours');
  const endSessions = () => act('sessions', () => adminService.endSessions(String(id)));
  const removeUser = async () => {
    if (emailConfirm.trim().toLowerCase() !== String(detail.email).toLowerCase()) {
      setError(strings.admin.confirmEmail);
      return;
    }
    const confirmed = await confirmDialog({
      title: strings.admin.deleteConfirm,
      message: `${strings.admin.delete}: ${detail.email}? Agreements and audit logs are retained.`,
      confirmText: strings.admin.delete,
      cancelText: strings.common.cancel,
      destructive: true,
    });
    if (!confirmed) return;
    await act(
      'delete',
      () =>
        adminService.invokeUserAction({
          action: 'soft_delete_user',
          userId: id,
          confirmEmail: emailConfirm.trim(),
        }),
      strings.toasts.adminDeleted
    );
    setEmailConfirm('');
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <PageHeaderBox
        title={profile.display_name || detail.email}
        subtitle={detail.email}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/admin/users'))}
        maxWidth={1080}
      />

      <ScrollView
        style={{ backgroundColor: theme.colors.background }}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Card tone="raised" padding="md">
          <Text style={[theme.type.body, { color: theme.colors.text }]}>{detail.email}</Text>
          <Text style={[theme.type.small, { color: theme.colors.muted }]}>{id}</Text>
          <Text style={[theme.type.small, { color: theme.colors.muted }]}>
            Created {new Date(detail.created_at).toLocaleString()} · Last sign in{' '}
            {detail.last_sign_in_at ? new Date(detail.last_sign_in_at).toLocaleString() : 'Never'}
          </Text>
          <Text style={[theme.type.small, { color: theme.colors.muted }]}>
            {detail.admin_role === 'super_admin' ? 'Platform Admin (Staff)' : profile.active_mode === 'hire' ? 'Hire Someone' : profile.active_mode === 'find_work' ? 'Find Work' : strings.admin.unselected} · {profile.status}
            {profile.must_change_password ? ' · Must change password' : ''}
          </Text>
        </Card>

        {error ? <AlertBox tone="danger" message={error} /> : null}

        <View style={[styles.sectionsGrid, isDesktop && styles.sectionsGridDesktop]}>
          {/* Left Column: Account Details & Role */}
          <View style={styles.col}>
            <Card tone="raised" padding="md" style={{ gap: 12 }}>
              <Text style={[theme.type.bodyStrong, { color: theme.colors.text }]}>
                Account & Profile Details
              </Text>
              <TextInput label={strings.admin.name} value={name} onChangeText={setName} />
              <TextInput label={strings.admin.area} value={area} onChangeText={setArea} />
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Button
                    title={`${strings.admin.active}${status === 'active' ? ' ✓' : ''}`}
                    variant={status === 'active' ? 'primary' : 'secondary'}
                    disabled={String(id) === currentUser?.id}
                    onPress={() => setStatus('active')}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    title={`${strings.admin.suspended}${status === 'suspended' ? ' ✓' : ''}`}
                    variant={status === 'suspended' ? 'primary' : 'secondary'}
                    disabled={String(id) === currentUser?.id}
                    onPress={() => setStatus('suspended')}
                  />
                </View>
              </View>
              <Button
                title={strings.admin.save}
                onPress={async () => {
                  if (status === 'suspended' && detail.profile?.status !== 'suspended') {
                    const confirmed = await confirmDialog({
                      title: 'Confirm Account Suspension',
                      message: `Suspend ${name || detail.email}? This will immediately terminate all active sessions and block them from logging in or transacting.`,
                      confirmText: 'Suspend Account',
                      cancelText: strings.common.cancel,
                      destructive: true,
                    });
                    if (!confirmed) return;
                  }
                  void act('save', () =>
                    adminService.updateUser({
                      userId: String(id),
                      displayName: name,
                      area,
                      status,
                    })
                  );
                }}
                loading={activeAction === 'save'}
                disabled={saving || !name.trim()}
              />
            </Card>

            {superAdmin ? (
              <Card tone="raised" padding="md" style={{ gap: 10 }}>
                <Text style={[theme.type.bodyStrong, { color: theme.colors.text }]}>
                  {strings.admin.role}: {detail.admin_role || 'user'}
                </Text>
                <View style={styles.row}>
                  {(['user', 'super_admin'] as const).map((value) => (
                    <View key={value} style={{ flex: 1, minWidth: 120 }}>
                      <Button
                        title={`${
                          value === 'user'
                            ? strings.admin.userRole
                            : strings.admin.superAdmin
                        }${role === value ? ' ✓' : ''}`}
                        variant={role === value ? 'primary' : 'secondary'}
                        onPress={() => setRole(value)}
                      />
                    </View>
                  ))}
                </View>
                <Button
                  title={String(id) === currentUser?.id ? 'Self-demotion blocked' : strings.admin.role}
                  variant="secondary"
                  onPress={setRoleAction}
                  loading={activeAction === 'role'}
                  disabled={saving || role === (detail.admin_role || 'user') || String(id) === currentUser?.id}
                />
              </Card>
            ) : null}
          </View>

          {/* Right Column: Security & Sessions + Danger Zone */}
          <View style={styles.col}>
            <Card tone="raised" padding="md" style={{ gap: 10 }}>
              <Text style={[theme.type.bodyStrong, { color: theme.colors.text }]}>
                Security & Sessions
              </Text>
              <Button
                title={strings.admin.resetPassword}
                variant="secondary"
                onPress={sendReset}
                loading={activeAction === 'reset'}
                disabled={saving || profile.status === 'deleted'}
              />
              <Button
                title={strings.admin.unlock}
                variant="secondary"
                onPress={unlock}
                loading={activeAction === 'unlock'}
                disabled={saving || profile.status === 'deleted'}
              />
              <Button
                title="Lock Login"
                variant="secondary"
                onPress={lock}
                loading={activeAction === 'lock'}
                disabled={saving || profile.status === 'deleted' || String(id) === currentUser?.id}
              />
              <Button
                title={strings.admin.endSessions}
                variant="secondary"
                onPress={endSessions}
                loading={activeAction === 'sessions'}
                disabled={saving}
              />
              <Text style={[theme.type.bodyStrong, { color: theme.colors.text, marginTop: 8 }]}>
                Sessions
              </Text>
              {(detail.sessions || []).map((session: any) => (
                <Card key={session.id} tone="outline" padding="sm">
                  <Text style={[theme.type.bodyStrong, { color: theme.colors.text }]}>
                    {session.device_label} · {session.platform}
                  </Text>
                  <Text style={[theme.type.small, { color: theme.colors.muted }]}>
                    {session.ended_at
                      ? `Ended ${new Date(session.ended_at).toLocaleString()}`
                      : `Active · ${new Date(session.last_seen_at).toLocaleString()}`}
                  </Text>
                </Card>
              ))}
            </Card>

            {profile.status !== 'deleted' && String(id) !== currentUser?.id ? (
              <Card tone="tinted-danger" padding="md" style={{ gap: 10 }}>
                <Text style={[theme.type.bodyStrong, { color: theme.colors.dangerText }]}>
                  Danger Zone
                </Text>
                <TextInput
                  label={strings.admin.confirmEmail}
                  value={emailConfirm}
                  onChangeText={setEmailConfirm}
                  autoCapitalize="none"
                />
                <Button
                  title={strings.admin.delete}
                  variant="danger"
                  onPress={removeUser}
                  loading={activeAction === 'delete'}
                  disabled={
                    saving ||
                    emailConfirm.trim().toLowerCase() !== String(detail.email).toLowerCase()
                  }
                />
              </Card>
            ) : null}
          </View>
        </View>

        <Button
          title={strings.common.back}
          variant="ghost"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/admin/users'))}
        />
      </ScrollView>
    </View>
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
  sectionsGrid: {
    gap: 12,
  },
  sectionsGridDesktop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
  },
  col: {
    flex: 1,
    gap: 12,
    minWidth: 0,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
