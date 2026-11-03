import React, { RefObject } from 'react';
import {
  View,
  Text,
  TextInput as RNTextInput,
  StyleSheet,
} from 'react-native';
import { useAppTheme } from '../../app/theme';
import { Category } from '../../services/profile';
import { strings } from '../../constants/strings';
import { Card } from '../ui/Card';
import { TextInput } from '../ui/TextInput';
import { Chip } from '../ui/Chip';
import { Button } from '../ui/Button';

interface ClientHiringProfileSectionProps {
  clientType: 'individual' | 'business' | 'organization' | 'other' | '';
  setClientType: (val: 'individual' | 'business' | 'organization' | 'other' | '') => void;
  businessName: string;
  setBusinessName: (val: string) => void;
  aboutHiring: string;
  setAboutHiring: (val: string) => void;
  categoriesList: Category[];
  selectedCategoryIds: string[];
  toggleHiringCategory: (id: string) => void;
  customCategories: string[];
  removeCustomCategory: (name: string) => void;
  customCategoryInput: string;
  setCustomCategoryInput: (val: string) => void;
  onAddCustomCategory: () => void;
  customCategoryInputRef: RefObject<RNTextInput | null>;
  totalSelectedInterests: number;
  maxHiringInterests: number;
  fieldErrors: Record<string, string>;
}

export const ClientHiringProfileSection: React.FC<ClientHiringProfileSectionProps> = ({
  clientType,
  setClientType,
  businessName,
  setBusinessName,
  aboutHiring,
  setAboutHiring,
  categoriesList,
  selectedCategoryIds,
  toggleHiringCategory,
  customCategories,
  removeCustomCategory,
  customCategoryInput,
  setCustomCategoryInput,
  onAddCustomCategory,
  customCategoryInputRef,
  totalSelectedInterests,
  maxHiringInterests,
  fieldErrors,
}) => {
  const theme = useAppTheme();

  return (
    <Card
      headerTitle="Client Hiring Details"
      headerIcon="business-outline"
      style={styles.roleSection}
    >
      {/* Client Type */}
      <View style={styles.inputGroup}>
        <Text style={[styles.label, { color: theme.colors.text }]}>Client Type</Text>
        <View style={styles.chipsWrap}>
          {strings.profile.clientTypeOptions.map((opt) => {
            const selected = clientType === opt.value;
            return (
              <Chip
                key={opt.value}
                label={opt.label}
                selected={selected}
                onPress={() => setClientType(selected ? '' : opt.value)}
                size="sm"
              />
            );
          })}
        </View>
      </View>

      {/* Business Name */}
      <TextInput
        label="Business or Organization Name (Optional, 2–60 characters)"
        value={businessName}
        onChangeText={setBusinessName}
        placeholder="e.g. Ormoc Print Shop"
        maxLength={60}
        error={fieldErrors.businessName}
        containerStyle={styles.inputGroup}
      />

      {/* Hiring Interests (up to 8 categories) */}
      <View style={styles.inputGroup}>
        <Text style={[styles.label, { color: theme.colors.text }]}>
          Hiring Interests ({totalSelectedInterests}/{maxHiringInterests})
        </Text>
        <Text style={[styles.helperText, { color: theme.colors.muted, marginBottom: 8 }]}>
          Select up to {maxHiringInterests} categories of work you usually hire for.
        </Text>

        {categoriesList.length > 0 ? (
          <View style={styles.chipsWrap}>
            {categoriesList.map((cat) => {
              const selected = selectedCategoryIds.includes(cat.id);
              return (
                <Chip
                  key={cat.id}
                  label={cat.name}
                  selected={selected}
                  onPress={() => toggleHiringCategory(cat.id)}
                  size="sm"
                />
              );
            })}
          </View>
        ) : null}

        <View style={styles.addRow}>
          <TextInput
            ref={customCategoryInputRef}
            value={customCategoryInput}
            onChangeText={setCustomCategoryInput}
            placeholder={strings.onboarding.addCustomCategoryPlaceholder}
            maxLength={50}
            containerStyle={styles.addInputWrap}
          />
          <Button
            title="Add"
            onPress={onAddCustomCategory}
            variant="primary"
            size="sm"
            icon="add"
          />
        </View>

        {customCategories.length > 0 ? (
          <View style={[styles.chipsWrap, { marginTop: 10 }]}>
            {customCategories.map((catName) => (
              <Chip
                key={catName}
                label={catName}
                selected
                onPress={() => removeCustomCategory(catName)}
                onRemove={() => removeCustomCategory(catName)}
                size="sm"
              />
            ))}
          </View>
        ) : null}

        {fieldErrors.hiringInterests ? (
          <Text style={[styles.fieldError, { color: theme.colors.dangerText }]}>
            {fieldErrors.hiringInterests}
          </Text>
        ) : null}
      </View>

      {/* About Hiring */}
      <TextInput
        label="What kind of help do you usually hire for? (Optional)"
        value={aboutHiring}
        onChangeText={setAboutHiring}
        placeholder="e.g. Graphic design, store errands, equipment maintenance..."
        multiline
        numberOfLines={3}
        maxLength={300}
        showCharCount
        error={fieldErrors.aboutHiring}
        containerStyle={{ marginBottom: 0 }}
      />
    </Card>
  );
};

const styles = StyleSheet.create({
  roleSection: {
    marginBottom: 20,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
  },
  fieldError: {
    fontSize: 12,
    marginTop: 4,
  },
  helperText: {
    fontSize: 12,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  addInputWrap: {
    flex: 1,
    marginBottom: 0,
  },
});
