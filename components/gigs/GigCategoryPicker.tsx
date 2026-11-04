import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useAppTheme } from '../../app/theme';
import { Category } from '../../services/profile';
import { SuggestedGigCategory, SimilarCategory } from '../../services/gigs';
import { TextInput } from '../ui/TextInput';
import { Button } from '../ui/Button';
import { Card, AlertBox } from '../ui/Card';
import { Chip } from '../ui/Chip';
import { strings } from '../../constants/strings';

interface GigCategoryPickerProps {
  categories: Category[];
  catsLoading: boolean;
  selectedCategoryId?: string;
  selectedCategoryIds?: string[];
  maxCategories?: number;
  customCategoryName: string;
  setCustomCategoryName: (name: string) => void;
  categoryQuery: string;
  setCategoryQuery: (query: string) => void;
  suggestedCategories: SuggestedGigCategory[];
  aiProposedCategory: string | null;
  similarCategories: SimilarCategory[];
  suggestLoading: boolean;
  onAiSuggestCategory: () => void;
  onSelectExistingCategory: (id: string) => void;
  onSelectCustomCategory: (name: string) => void;
}

export const GigCategoryPicker: React.FC<GigCategoryPickerProps> = ({
  categories,
  catsLoading,
  selectedCategoryId,
  selectedCategoryIds,
  maxCategories = 3,
  customCategoryName,
  setCustomCategoryName,
  categoryQuery,
  setCategoryQuery,
  suggestedCategories,
  aiProposedCategory,
  similarCategories,
  suggestLoading,
  onAiSuggestCategory,
  onSelectExistingCategory,
  onSelectCustomCategory,
}) => {
  const theme = useAppTheme();

  const activeIds = selectedCategoryIds ?? (selectedCategoryId ? [selectedCategoryId] : []);

  const normalizedQuery = categoryQuery.replace(/\s+/g, ' ').trim();
  const filteredExistingCategories = normalizedQuery
    ? categories.filter((c) => c.name.toLowerCase().includes(normalizedQuery.toLowerCase()))
    : categories;
  const exactExistingMatch = categories.find(
    (c) => c.name.trim().toLowerCase() === normalizedQuery.toLowerCase()
  );
  const canProposeTypedCategory =
    normalizedQuery.length >= 3 && normalizedQuery.length <= 40 && !exactExistingMatch;

  return (
    <Card
      headerTitle={strings.gigs.categoryLabel}
      headerSubtitle={`Select up to ${maxCategories} categories (1 Primary + up to ${maxCategories - 1} Related) to maximize freelancer discovery.`}
      headerIcon="pricetag-outline"
      headerRight={
        <Button
          title={
            suggestLoading
              ? strings.gigs.aiSuggestingCategory
              : strings.gigs.aiSuggestCategoryBtn
          }
          variant="ai"
          size="xs"
          icon="sparkles"
          loading={suggestLoading}
          disabled={suggestLoading}
          onPress={onAiSuggestCategory}
        />
      }
      style={styles.fieldGroup}
    >
      {/* Selected custom category pill */}
      {customCategoryName ? (
        <AlertBox
          tone="info"
          icon="checkmark-circle"
          title={`New category selected: ${customCategoryName}`}
          actionLabel="Change"
          onAction={() => setCustomCategoryName('')}
        />
      ) : null}

      {/* Selected categories summary tray */}
      {activeIds.length > 0 && !customCategoryName && (
        <View style={styles.selectedTray}>
          <Text style={[styles.subSectionLabel, { color: theme.colors.muted }]}>
            {`Selected Categories (${activeIds.length}/${maxCategories})`}
          </Text>
          <View style={styles.selectedChipsWrap}>
            {activeIds.map((id, idx) => {
              const matched = categories.find((c) => c.id === id) || suggestedCategories.find((s) => s.id === id);
              const name = matched?.name || id;
              const isPrimary = idx === 0;
              return (
                <Chip
                  key={`sel-${id}`}
                  label={`${name} (${isPrimary ? 'Primary' : 'Related'})`}
                  icon={isPrimary ? 'star' : 'pricetag'}
                  selected
                  onPress={() => onSelectExistingCategory(id)}
                  onRemove={() => onSelectExistingCategory(id)}
                  style={{ marginRight: 6, marginBottom: 6 }}
                />
              );
            })}
          </View>
        </View>
      )}

      {/* Suggested Categories */}
      {suggestedCategories.length > 0 && (
        <View style={styles.suggestedSection}>
          <Text style={[styles.subSectionLabel, { color: theme.colors.muted }]}>
            {strings.gigs.suggestedCategoriesLabel}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catRow}>
            {suggestedCategories.map((sug) => {
              const isSelected =
                (!customCategoryName && activeIds.includes(sug.id)) ||
                (!customCategoryName &&
                  categories.some((c) => activeIds.includes(c.id) && c.name.trim().toLowerCase() === sug.name.trim().toLowerCase())) ||
                (Boolean(customCategoryName) &&
                  customCategoryName.trim().toLowerCase() === sug.name.trim().toLowerCase());
              const isPrimary = activeIds[0] === sug.id;
              return (
                <Chip
                  key={`sug-${sug.id}`}
                  label={isSelected ? `${sug.name} (${isPrimary ? 'Primary' : 'Related'})` : sug.name}
                  icon="sparkles"
                  selected={isSelected}
                  onPress={() => onSelectExistingCategory(sug.id)}
                  style={{ marginRight: 8 }}
                />
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Optional AI-proposed new category */}
      {aiProposedCategory && (
        <View style={styles.suggestedSection}>
          <Text style={[styles.subSectionLabel, { color: theme.colors.muted }]}>
            {strings.gigs.aiProposedCategoryLabel}
          </Text>
          <View style={{ alignItems: 'flex-start' }}>
            <Chip
              label={`+ ${aiProposedCategory}`}
              icon="add-circle-outline"
              selected={(customCategoryName || '').toLowerCase() === (aiProposedCategory || '').toLowerCase()}
              onPress={() => onSelectCustomCategory(aiProposedCategory)}
            />
          </View>
        </View>
      )}

      {/* Search or create category input */}
      <TextInput
        label="Search or Create Category"
        placeholder={strings.gigs.searchOrCreateCategoryPlaceholder}
        value={categoryQuery}
        onChangeText={setCategoryQuery}
        leftIcon="search-outline"
        onClear={() => setCategoryQuery('')}
      />

      {/* Existing categories list */}
      {catsLoading ? (
        <ActivityIndicator size="small" color={theme.colors.primary} style={{ marginVertical: 8 }} />
      ) : filteredExistingCategories.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catRow}>
          {filteredExistingCategories.map((cat) => {
            const isSelected = activeIds.includes(cat.id) && !customCategoryName;
            const isPrimary = activeIds[0] === cat.id;
            return (
              <Chip
                key={cat.id}
                label={isSelected ? `${cat.name} (${isPrimary ? 'Primary' : 'Related'})` : cat.name}
                selected={isSelected}
                onPress={() => onSelectExistingCategory(cat.id)}
                style={{ marginRight: 8 }}
              />
            );
          })}
        </ScrollView>
      ) : null}

      {/* Did you mean? Box */}
      {canProposeTypedCategory && (
        <Card tone="inset" padding="sm" style={styles.didYouMeanBox}>
          {similarCategories.length > 0 ? (
            <>
              <Text style={[styles.didYouMeanTitle, { color: theme.colors.text }]}>
                {strings.gigs.didYouMeanLabel}
              </Text>
              <View style={styles.similarChipsWrap}>
                {similarCategories.map((sim) => {
                  const isSelected = selectedCategoryId === sim.id && !customCategoryName;
                  return (
                    <Chip
                      key={`sim-${sim.id}`}
                      label={sim.name}
                      size="sm"
                      selected={isSelected}
                      onPress={() => {
                        onSelectExistingCategory(sim.id);
                        setCategoryQuery('');
                      }}
                    />
                  );
                })}
              </View>
              <Button
                title={`${strings.gigs.confirmCreateNewCategoryPrefix} "${normalizedQuery}" ${strings.gigs.confirmCreateNewCategorySuffix}`}
                variant="secondary"
                size="sm"
                icon="add-circle-outline"
                onPress={() => onSelectCustomCategory(normalizedQuery)}
                fullWidth
              />
            </>
          ) : (
            <Button
              title={`+ ${strings.gigs.addNewCategoryPrefix} "${normalizedQuery}" ${strings.gigs.addNewCategorySuffix}`}
              variant="soft"
              size="sm"
              icon="add-circle-outline"
              onPress={() => onSelectCustomCategory(normalizedQuery)}
              fullWidth
            />
          )}
        </Card>
      )}
    </Card>
  );
};

const styles = StyleSheet.create({
  fieldGroup: {
    marginBottom: 16,
  },
  suggestedSection: {
    marginBottom: 12,
  },
  subSectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
  },
  catRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  didYouMeanBox: {
    marginTop: 8,
    marginBottom: 0,
  },
  didYouMeanTitle: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  similarChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  selectedTray: {
    marginBottom: 14,
    padding: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(37, 99, 235, 0.06)',
  },
  selectedChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
});
