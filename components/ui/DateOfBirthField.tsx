import React, { useMemo, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useAppTheme } from '../../app/theme';
import { strings } from '../../constants/strings';
import { Button } from './Button';
import { getAdultBirthDateCutoff, formatLocalIsoDate, parseIsoDate } from '../../utils/dateOfBirth';

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
}

const minimumDate = new Date(1900, 0, 1, 12);

export function DateOfBirthField({ label, value, onChange, error }: Props) {
  const theme = useAppTheme();
  const maximumDate = useMemo(() => getAdultBirthDateCutoff(), []);
  const [visible, setVisible] = useState(false);
  const [draftDate, setDraftDate] = useState(() => parseIsoDate(value) || maximumDate);

  const formattedValue = value
    ? new Intl.DateTimeFormat('en-PH', { dateStyle: 'long' }).format(parseIsoDate(value) || maximumDate)
    : strings.auth.dateOfBirthPlaceholder;

  if (Platform.OS === 'web') {
    const webInput = React.createElement('input', {
      type: 'date',
      id: 'date-of-birth',
      name: 'dateOfBirth',
      autoComplete: 'bday',
      value,
      min: '1900-01-01',
      max: formatLocalIsoDate(maximumDate),
      'aria-label': label,
      onChange: (event: { target: { value: string } }) => onChange(event.target.value),
      style: {
        boxSizing: 'border-box',
        width: '100%',
        minHeight: 54,
        padding: '12px 16px',
        fontSize: 16,
        color: theme.colors.text,
        backgroundColor: theme.colors.surfaceAlt,
        border: `${error ? '2px' : '1px'} solid ${error ? theme.colors.danger : theme.colors.border}`,
        borderRadius: theme.radii.input,
        outline: 'none',
      },
    });

    return (
      <View style={styles.container}>
        <Text style={[styles.label, { color: theme.colors.text }]}>{label}</Text>
        {webInput}
        {error ? <Text style={[styles.error, { color: theme.colors.dangerText }]}>{error}</Text> : null}
      </View>
    );
  }

  const openPicker = () => {
    setDraftDate(parseIsoDate(value) || maximumDate);
    setVisible(true);
  };

  const handleValueChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    if (event.type === 'dismissed') {
      setVisible(false);
      return;
    }
    if (Platform.OS === 'ios') {
      if (selectedDate) setDraftDate(selectedDate);
      return;
    }
    setVisible(false);
    if (selectedDate) onChange(formatLocalIsoDate(selectedDate));
  };

  const handleDismiss = () => {
    setVisible(false);
  };

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: theme.colors.text }]}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${formattedValue}`}
        accessibilityHint={strings.auth.dateOfBirthHint}
        onPress={openPicker}
        style={({ pressed }) => [
          styles.valueButton,
          {
            backgroundColor: theme.colors.surfaceAlt,
            borderColor: error ? theme.colors.danger : theme.colors.border,
            borderWidth: error ? 2 : 1,
            borderRadius: theme.radii.input,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <Text style={[theme.type.body, { color: value ? theme.colors.text : theme.colors.muted }]}>{formattedValue}</Text>
      </Pressable>
      {error ? <Text style={[styles.error, { color: theme.colors.dangerText }]}>{error}</Text> : null}

      {Platform.OS === 'android' && visible ? (
        <DateTimePicker
          value={draftDate}
          mode="date"
          display="default"
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          onChange={handleValueChange}
        />
      ) : null}

      {Platform.OS === 'ios' ? (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={() => setVisible(false)}>
          <View style={[styles.overlay, { backgroundColor: theme.colors.overlay }]}>
            <View style={[styles.modalCard, { backgroundColor: theme.colors.surface }]}>
              <Text style={[theme.type.title, { color: theme.colors.text }]}>{strings.auth.dateOfBirthPickerTitle}</Text>
              <DateTimePicker
                value={draftDate}
                mode="date"
                display="spinner"
                minimumDate={minimumDate}
                maximumDate={maximumDate}
                onChange={handleValueChange}
              />
              <View style={styles.actions}>
                <Button title={strings.common.cancel} variant="secondary" style={{ flex: 1 }} onPress={() => setVisible(false)} />
                <Button
                  title={strings.common.save}
                  style={{ flex: 1 }}
                  onPress={() => {
                    onChange(formatLocalIsoDate(draftDate));
                    setVisible(false);
                  }}
                />
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 16 },
  label: { fontSize: 14, lineHeight: 18, fontWeight: '700', marginBottom: 8, letterSpacing: 0.1 },
  valueButton: { minHeight: 54, justifyContent: 'center', paddingHorizontal: 16, borderWidth: 1 },
  error: { fontSize: 12, marginTop: 4, fontWeight: '600', lineHeight: 16 },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  modalCard: { padding: 20, paddingBottom: 32, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 12 },
});
