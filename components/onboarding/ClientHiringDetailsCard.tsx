import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../app/theme';
import { Category } from '../../services/profile';
import { strings } from '../../constants/strings';
import { Card, AlertBox } from '../ui/Card';
import { TextInput } from '../ui/TextInput';
import { Chip } from '../ui/Chip';
import { Button } from '../ui/Button';

interface ClientHiringDetailsCardProps {
  clientType: 'individual' | 'business' | 'organization' | 'other' | '';
  setClientType: (type: 'individual' | 'business' | 'organization' | 'other' | '') => void;
  businessName: string;
  setBusinessName: (name: string) => void;
  aboutHiring: string;
  setAboutHiring: (note: string) => void;
  catalogCategories: Category[];
  catalogLoading: boolean;
  selectedCategoryIds: string[];
  toggleCatalogCategory: (id: string) => void;
  helpDescription: string;
  setHelpDescription: (desc: string) => void;
  aiCategorySuggestions: string[];
  onSuggestCategories: () => void;
  aiLoading: boolean;
  aiError: string | null;
  selectedCustomCategories: string[];
  toggleCustomCategory: (name: string) => void;
  customCategoryInput: string;
  setCustomCategoryInput: (input: string) => void;
  onAddCustomCategory: () => void;
  totalSelectedInterests: number;
  maxHiringInterests: number;
}

export const ClientHiringDetailsCard: React.FC<ClientHiringDetailsCardProps> = ({
  clientType,
  setClientType,
  businessName,
  setBusinessName,
  aboutHiring,
  setAboutHiring,
  catalogCategories,
  catalogLoading,
  selectedCategoryIds,
  toggleCatalogCategory,
  helpDescription,
  setHelpDescription,
  aiCategorySuggestions,
  onSuggestCategories,
  aiLoading,
  aiError,
  selectedCustomCategories,
  toggleCustomCategory,
  customCategoryInput,
  setCustomCategoryInput,
  onAddCustomCategory,
  totalSelectedInterests,
  maxHiringInterests,
}) => {
  const theme = useAppTheme();
  const [customCatInlineError, setCustomCatInlineError] = useState<string | null>(null);

  const handleCustomCatChange = (text: string) => {
    setCustomCategoryInput(text);
    if (customCatInlineError) {
      setCustomCatInlineError(null);
    }
  };

  const handleAddCustomCat = () => {
    const trimmed = customCategoryInput.trim();
    if (!trimmed) return;
    if (trimmed.length < 2 || trimmed.length > 50) {
      setCustomCatInlineError('Category name must be between 2 and 50 characters.');
      return;
    }
    if (totalSelectedInterests >= maxHiringInterests) {
      setCustomCatInlineError(`You can select at most ${maxHiringInterests} hiring interests.`);
      return;
    }
    setCustomCatInlineError(null);
    onAddCustomCategory();
  };

  return (
    <>
      {/* Client Type */}
      <Card
        headerTitle="Who are you hiring as?"
        headerSubtitle="Let freelancers know if you are hiring for yourself, a small business, or an organization."
        headerIcon="business-outline"
        style={styles.card}
      >
        <View style={styles.chipsWrap}>
          {strings.profile.clientTypeOptions.map((opt) => {
            const selected = clientType === opt.value;
            return (
              <Chip
                key={opt.value}
                label={opt.label}
                selected={selected}
                onPress={() => {
                  const next = selected ? '' : opt.value;
                  setClientType(next);
                  if (next === 'individual') {
                    setBusinessName('');
                  }
                }}
              />
            );
          })}
        </View>

        {clientType !== 'individual' && clientType !== '' && (
          <TextInput
            label="Business or Organization Name (Optional, 2–60 characters)"
            placeholder="e.g. Ormoc Tech Solutions or Villa Laundry"
            value={businessName}
            onChangeText={setBusinessName}
            maxLength={60}
            showCharCount
            containerStyle={{ marginTop: 14, marginBottom: 0 }}
          />
        )}
      </Card>

      {/* AI Category Suggestions for Clients */}
      <Card
        headerTitle="Suggest Categories with AI"
        headerSubtitle="Describe what you usually need help with, and our assistant will suggest matching categories."
        headerIcon="sparkles-outline"
        style={styles.card}
      >
        <TextInput
          placeholder={strings.onboarding.aiCategoriesPlaceholder}
          value={helpDescription}
          onChangeText={setHelpDescription}
          multiline
          numberOfLines={2}
          maxLength={600}
          containerStyle={{ marginBottom: 12 }}
        />

        {aiError && (
          <AlertBox
            tone="danger"
            message={aiError}
            actionLabel="Retry"
            onAction={onSuggestCategories}
            style={{ marginBottom: 12 }}
          />
        )}

        <Button
          title={aiLoading ? strings.onboarding.suggestingCategories : strings.onboarding.suggestCategoriesBtn}
          onPress={onSuggestCategories}
          variant="ai"
          size="md"
          icon="sparkles"
          loading={aiLoading}
          disabled={aiLoading}
          fullWidth
        />

        {aiCategorySuggestions.length > 0 && (
          <Card tone="inset" padding="sm" style={styles.suggestionsContainer}>
            <View style={styles.suggestionsHeader}>
              <Ionicons name="bulb-outline" size={16} color={theme.colors.spark} />
              <Text style={[styles.subLabel, { color: theme.colors.text }]}>
                Suggested Categories (tap to toggle):
              </Text>
            </View>
            <View style={styles.chipsWrap}>
              {aiCategorySuggestions.map((catName) => {
                const catalogMatch = catalogCategories.find(
                  (c) => c.name.toLowerCase() === catName.toLowerCase()
                );
                const selected = catalogMatch
                  ? selectedCategoryIds.includes(catalogMatch.id)
                  : selectedCustomCategories.some(
                      (c) => c.toLowerCase() === catName.toLowerCase()
                    );
                return (
                  <Chip
                    key={catName}
                    label={`${selected ? '✓ ' : '+ '}${catName}`}
                    selected={selected}
                    size="sm"
                    onPress={() =>
                      catalogMatch
                        ? toggleCatalogCategory(catalogMatch.id)
                        : toggleCustomCategory(catName)
                    }
                  />
                );
              })}
            </View>
          </Card>
        )}
      </Card>

      {/* Hiring Interests Catalog & Custom Category Input */}
      <Card
        headerTitle={`Hiring Interests (${totalSelectedInterests}/${maxHiringInterests})`}
        headerSubtitle={`Pick up to ${maxHiringInterests} categories of work you usually hire for.`}
        headerIcon="grid-outline"
        style={styles.card}
      >
        {catalogLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={[styles.loadingText, { color: theme.colors.muted }]}>Loading categories...</Text>
          </View>
        ) : catalogCategories.length > 0 ? (
          <View style={[styles.chipsWrap, { marginBottom: 14 }]}>
            {catalogCategories.map((cat) => {
              const selected = selectedCategoryIds.includes(cat.id);
              return (
                <Chip
                  key={cat.id}
                  label={cat.name}
                  selected={selected}
                  size="sm"
                  onPress={() => toggleCatalogCategory(cat.id)}
                />
              );
            })}
          </View>
        ) : null}

        <View style={styles.customInputRow}>
          <TextInput
            placeholder={strings.onboarding.addCustomCategoryPlaceholder}
            value={customCategoryInput}
            onChangeText={handleCustomCatChange}
            maxLength={50}
            error={customCatInlineError || undefined}
            onSubmitEditing={handleAddCustomCat}
            returnKeyType="done"
            containerStyle={styles.customInputWrap}
          />
          <Button
            title="Add"
            onPress={handleAddCustomCat}
            variant="primary"
            size="sm"
            icon="add"
            disabled={!customCategoryInput.trim()}
          />
        </View>

        {selectedCustomCategories.length > 0 && (
          <View style={[styles.chipsWrap, { marginTop: 12 }]}>
            {selectedCustomCategories.map((catName) => (
              <Chip
                key={catName}
                label={catName}
                selected
                size="sm"
                onPress={() => toggleCustomCategory(catName)}
                onRemove={() => toggleCustomCategory(catName)}
              />
            ))}
          </View>
        )}
      </Card>

      {/* About Hiring */}
      <Card
        headerTitle="What kind of work do you usually need? (Optional)"
        headerSubtitle="Provide a brief summary for freelancers visiting your client profile."
        headerIcon="document-text-outline"
        style={styles.card}
      >
        <TextInput
          placeholder="e.g. Occasional home repairs, graphic design for local store promotions, aircon maintenance..."
          value={aboutHiring}
          onChangeText={setAboutHiring}
          multiline
          numberOfLines={3}
          maxLength={300}
          showCharCount
          containerStyle={{ marginBottom: 0 }}
        />
      </Card>
    </>
  );
};

const styles = StyleSheet.create({
  card: {
    marginBottom: 16,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  suggestionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  subLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  suggestionsContainer: {
    marginTop: 14,
  },
  customInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  customInputWrap: {
    flex: 1,
    marginBottom: 0,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
  },
});
