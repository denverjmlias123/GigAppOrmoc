import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../app/theme';
import { TextInput } from '../ui/TextInput';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { strings } from '../../constants/strings';

export type WorkType = 'remote' | 'face_to_face' | 'hybrid';

interface GigTermsFormProps {
  requirements: string;
  setRequirements: (val: string) => void;
  priceMinStr: string;
  setPriceMinStr: (val: string) => void;
  priceMaxStr: string;
  setPriceMaxStr: (val: string) => void;
  workType: WorkType;
  setWorkType: (val: WorkType) => void;
  area: string;
  setArea: (val: string) => void;
  appDays: string;
  setAppDays: (val: string) => void;
  completionDays: string;
  setCompletionDays: (val: string) => void;
  editGigId?: string;
  existingGigStatus: 'draft' | 'open' | null;
  loading: boolean;
  onPublish: () => void;
  onSaveDraft: () => void;
}

const WORK_TYPES: {
  key: WorkType;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}[] = [
  { key: 'remote', label: 'Remote', icon: 'laptop-outline' },
  { key: 'face_to_face', label: 'Face-to-Face', icon: 'people-outline' },
  { key: 'hybrid', label: 'Hybrid', icon: 'sync-outline' },
];

export const GigTermsForm: React.FC<GigTermsFormProps> = ({
  requirements,
  setRequirements,
  priceMinStr,
  setPriceMinStr,
  priceMaxStr,
  setPriceMaxStr,
  workType,
  setWorkType,
  area,
  setArea,
  appDays,
  setAppDays,
  completionDays,
  setCompletionDays,
  editGigId,
  existingGigStatus,
  loading,
  onPublish,
  onSaveDraft,
}) => {
  const theme = useAppTheme();

  return (
    <>
      <Card
        headerTitle="Scope & Budget Terms"
        headerSubtitle="Set clear deliverables, budget range, and work arrangement"
        headerIcon="cash-outline"
      >
        <TextInput
          label="Requirements (optional)"
          placeholder="Tools, experience, or specific qualifications needed..."
          value={requirements}
          onChangeText={setRequirements}
          multiline
          numberOfLines={3}
          style={{ minHeight: 74 }}
        />

        {/* Budget Row in PHP */}
        <View style={styles.row}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <TextInput
              label="Min Budget (₱) *"
              placeholder="500"
              prefixText="₱"
              value={priceMinStr}
              onChangeText={setPriceMinStr}
              keyboardType="numeric"
            />
          </View>
          <View style={{ flex: 1, marginLeft: 8 }}>
            <TextInput
              label="Max Budget (₱) *"
              placeholder="1000"
              prefixText="₱"
              value={priceMaxStr}
              onChangeText={setPriceMaxStr}
              keyboardType="numeric"
            />
          </View>
        </View>

        {/* Work Type */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.fieldLabel, { color: theme.colors.text }]}>Work Type *</Text>
          <View style={styles.workTypeRow}>
            {WORK_TYPES.map((wt) => {
              const selected = workType === wt.key;
              return (
                <Pressable
                  key={wt.key}
                  onPress={() => setWorkType(wt.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={(state: any) => [
                    styles.workTypeBtn,
                    {
                      borderColor:
                        selected || state.hovered ? theme.colors.primary : theme.colors.border,
                      backgroundColor: selected
                        ? theme.colors.primarySoft
                        : state.pressed || state.hovered
                        ? theme.colors.surfaceAlt
                        : theme.colors.surface,
                      borderWidth: selected ? 1.5 : 1,
                      ...({ cursor: 'pointer' } as any),
                    },
                  ]}
                >
                  <Ionicons
                    name={wt.icon}
                    size={18}
                    color={selected ? theme.colors.primary : theme.colors.muted}
                  />
                  <Text
                    style={[
                      styles.workTypeText,
                      {
                        color: selected ? theme.colors.primary : theme.colors.text,
                        fontWeight: selected ? '800' : '600',
                      },
                    ]}
                  >
                    {wt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <TextInput
          label="Barangay / Location in Ormoc"
          placeholder="e.g. Cogon or Ormoc City proper"
          leftIcon="location-outline"
          value={area}
          onChangeText={setArea}
        />

        {/* Deadlines */}
        <View style={styles.row}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <TextInput
              label="Application Days"
              placeholder="7"
              leftIcon="calendar-outline"
              value={appDays}
              onChangeText={setAppDays}
              keyboardType="numeric"
              helperText="Days to accept proposals"
            />
          </View>
          <View style={{ flex: 1, marginLeft: 8 }}>
            <TextInput
              label="Completion Days"
              placeholder="14"
              leftIcon="time-outline"
              value={completionDays}
              onChangeText={setCompletionDays}
              keyboardType="numeric"
              helperText="Days to finish gig"
            />
          </View>
        </View>
      </Card>

      {/* Actions */}
      <View style={styles.actionRow}>
        {editGigId && existingGigStatus === 'open' ? (
          <Button
            title="Save Changes"
            onPress={onSaveDraft}
            variant="primary"
            icon="checkmark-circle-outline"
            loading={loading}
            disabled={loading}
            fullWidth
          />
        ) : (
          <>
            <Button
              title={strings.gigs.publishBtn}
              onPress={onPublish}
              variant="primary"
              icon="rocket-outline"
              loading={loading}
              disabled={loading}
              fullWidth
              style={{ marginBottom: 12 }}
            />
            <Button
              title={editGigId ? 'Save Changes' : strings.gigs.saveDraftBtn}
              onPress={onSaveDraft}
              variant="secondary"
              icon="bookmark-outline"
              disabled={loading}
              fullWidth
            />
          </>
        )}
      </View>
    </>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
  },
  fieldGroup: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 14, lineHeight: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  workTypeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  workTypeBtn: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  workTypeText: {
    fontSize: 13, lineHeight: 18,
  },
  actionRow: {
    marginTop: 8,
  },
});
