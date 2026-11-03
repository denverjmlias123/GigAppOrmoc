import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAppTheme } from '../../theme';
import { adminService } from '../../../services/admin';
import { strings, mapSqlErrorToFriendlyMessage } from '../../../constants/strings';
import { TextInput } from '../../../components/ui/TextInput';
import { DateOfBirthField } from '../../../components/ui/DateOfBirthField';
import { Button } from '../../../components/ui/Button';
import { Card, AlertBox, PageHeaderBox } from '../../../components/ui/Card';
import { PasswordPolicyChecklist } from '../../../components/ui/PasswordPolicyChecklist';
import { showToast } from '../../../components/ui/Toast';

export default function CreateAdminUser() {
  const theme = useAppTheme();
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [dob, setDob] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'user' | 'super_admin'>('user');
  const [superAdmin, setSuperAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    adminService.isSuperAdmin().then(setSuperAdmin).catch(() => setSuperAdmin(false));
  }, []);

  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const create = async () => {
    if (saving) return;
    setError(null);

    const trimmedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError(strings.auth.invalidEmailFormat);
      return;
    }
    if (role === 'super_admin' && !superAdmin) {
      setError('Only Super Admin can provision administrative accounts.');
      return;
    }

    setSaving(true);
    try {
      await adminService.invokeUserAction({
        action: 'create_user',
        displayName: displayName.trim(),
        email: trimmedEmail,
        dob,
        temporaryPassword: password,
        role,
      });
      showToast(strings.toasts.adminCreated);
      router.replace('/admin/users');
    } catch (e) {
      setError(mapSqlErrorToFriendlyMessage(e, strings.errors.serverError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <PageHeaderBox
        title={strings.admin.createTitle}
        subtitle="Create a new user or admin account"
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/admin/users'))}
        maxWidth={680}
      />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {error ? <AlertBox tone="danger" message={error} /> : null}

        <Card tone="raised" padding="lg" style={{ gap: 12 }}>
          <TextInput
            label={strings.admin.name}
            value={displayName}
            onChangeText={setDisplayName}
            autoComplete="name"
          />
          <TextInput
            label={strings.admin.email}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />
          <DateOfBirthField label={strings.admin.dob} value={dob} onChange={setDob} />
          <TextInput
            label={strings.admin.temporaryPassword}
            value={password}
            onChangeText={setPassword}
            isPassword
            autoCapitalize="none"
            autoComplete="new-password"
          />
          <PasswordPolicyChecklist password={password} email={email} displayName={displayName} />

          <Text style={[theme.type.bodyStrong, { color: theme.colors.text, marginTop: 8 }]}>
            {strings.admin.role}
          </Text>
          <View style={styles.roleRow}>
            <View style={styles.roleBtnWrap}>
              <Button
                title={`${strings.admin.userRole}${role === 'user' ? ' ✓' : ''}`}
                variant={role === 'user' ? 'primary' : 'secondary'}
                onPress={() => setRole('user')}
              />
            </View>
            {superAdmin ? (
              <View style={styles.roleBtnWrap}>
                <Button
                  title={`${strings.admin.superAdmin}${role === 'super_admin' ? ' ✓' : ''}`}
                  variant={role === 'super_admin' ? 'primary' : 'secondary'}
                  onPress={() => setRole('super_admin')}
                />
              </View>
            ) : null}
          </View>

          <View style={styles.actionRow}>
            <View style={{ flex: 1 }}>
              <Button
                title={strings.common.cancel}
                variant="secondary"
                onPress={() => (router.canGoBack() ? router.back() : router.replace('/admin/users'))}
                disabled={saving}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                title={strings.admin.createUser}
                onPress={create}
                loading={saving}
                disabled={saving || !displayName.trim() || !isEmailValid || !dob || !password}
              />
            </View>
          </View>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    padding: 20,
    gap: 12,
    maxWidth: 680,
    width: '100%',
    alignSelf: 'center',
  },
  roleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  roleBtnWrap: {
    flex: 1,
    minWidth: 140,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
});
