import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../app/theme';
import { Skill, profileService } from '../../services/profile';
import { strings } from '../../constants/strings';
import { Card, AlertBox } from '../ui/Card';
import { TextInput } from '../ui/TextInput';
import { Chip } from '../ui/Chip';
import { Button } from '../ui/Button';

interface FreelancerSkillSectionsProps {
  workDescription: string;
  setWorkDescription: (desc: string) => void;
  aiSuggestions: string[];
  selectedAiSkills: string[];
  toggleAiSkill: (skill: string) => void;
  savedSkills: Skill[];
  aiLoading: boolean;
  aiError: string | null;
  onSuggestSkills: () => void;
  catalogSkills: Skill[];
  catalogLoading: boolean;
  selectedCatalogIds: string[];
  toggleCatalogSkill: (id: string) => void;
  customInput: string;
  setCustomInput: (input: string) => void;
  onAddCustomSkill: () => void;
}

export const FreelancerSkillSections: React.FC<FreelancerSkillSectionsProps> = ({
  workDescription,
  setWorkDescription,
  aiSuggestions,
  selectedAiSkills,
  toggleAiSkill,
  savedSkills,
  aiLoading,
  aiError,
  onSuggestSkills,
  catalogSkills,
  catalogLoading,
  selectedCatalogIds,
  toggleCatalogSkill,
  customInput,
  setCustomInput,
  onAddCustomSkill,
}) => {
  const theme = useAppTheme();
  const [catalogSearch, setCatalogSearch] = useState('');
  const [customInlineError, setCustomInlineError] = useState<string | null>(null);

  const filteredCatalog = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    if (!q) return catalogSkills;
    return catalogSkills.filter((s) => s.name.toLowerCase().includes(q));
  }, [catalogSkills, catalogSearch]);

  const handleCustomInputChange = (text: string) => {
    setCustomInput(text);
    if (customInlineError) {
      setCustomInlineError(null);
    }
  };

  const handleAddCustom = () => {
    const validation = profileService.validateSkillName(customInput);
    if (!validation.valid) {
      setCustomInlineError(validation.error || 'Please enter a valid skill name.');
      return;
    }
    setCustomInlineError(null);
    onAddCustomSkill();
  };

  return (
    <>
      {/* AI Skill Suggestion Card */}
      <Card
        headerTitle="Suggest Skills with AI"
        headerSubtitle="Describe the services or work you provide in plain words, and our assistant will suggest matching skills."
        headerIcon="sparkles-outline"
        style={styles.card}
      >
        <TextInput
          placeholder={strings.onboarding.aiSkillsPlaceholder}
          value={workDescription}
          onChangeText={setWorkDescription}
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
            onAction={onSuggestSkills}
            style={{ marginBottom: 12 }}
          />
        )}

        <Button
          title={aiLoading ? strings.onboarding.suggestingSkills : strings.onboarding.suggestSkillsBtn}
          onPress={onSuggestSkills}
          variant="ai"
          size="md"
          icon="sparkles"
          loading={aiLoading}
          disabled={aiLoading}
          fullWidth
        />

        {aiSuggestions.length > 0 && (
          <Card tone="inset" padding="sm" style={styles.suggestionsContainer}>
            <View style={styles.suggestionsHeader}>
              <Ionicons name="bulb-outline" size={16} color={theme.colors.spark} />
              <Text style={[styles.subLabel, { color: theme.colors.text }]}>
                Suggested Skills (tap to add or remove):
              </Text>
            </View>
            <View style={styles.chipsWrap}>
              {aiSuggestions.map((skill) => {
                const lower = skill.trim().toLowerCase();
                const selected =
                  selectedAiSkills.some((s) => s.trim().toLowerCase() === lower) ||
                  savedSkills.some((s) => s.name.trim().toLowerCase() === lower);
                return (
                  <Chip
                    key={skill}
                    label={`${selected ? '✓ ' : '+ '}${skill}`}
                    selected={selected}
                    size="sm"
                    onPress={() => toggleAiSkill(skill)}
                  />
                );
              })}
            </View>
          </Card>
        )}
      </Card>

      {/* Catalog Skills Card */}
      {catalogLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
          <Text style={[styles.loadingText, { color: theme.colors.muted }]}>Loading catalog skills...</Text>
        </View>
      ) : catalogSkills.length > 0 ? (
        <Card
          headerTitle="Skills Catalog"
          headerSubtitle="Select skills from our local marketplace catalog."
          headerIcon="list-outline"
          style={styles.card}
        >
          {catalogSkills.length > 6 && (
            <TextInput
              placeholder="Search catalog skills..."
              value={catalogSearch}
              onChangeText={setCatalogSearch}
              leftIcon="search-outline"
              onClear={catalogSearch ? () => setCatalogSearch('') : undefined}
              containerStyle={{ marginBottom: 14 }}
            />
          )}

          {filteredCatalog.length === 0 ? (
            <View style={styles.emptySearchBox}>
              <Ionicons name="search-outline" size={24} color={theme.colors.muted} />
              <Text style={[styles.emptySearchText, { color: theme.colors.muted }]}>
                No catalog skills found matching "{catalogSearch}". You can add it below as a custom skill.
              </Text>
            </View>
          ) : (
            <View style={styles.chipsWrap}>
              {filteredCatalog.map((skill) => {
                const selected =
                  selectedCatalogIds.includes(skill.id) ||
                  savedSkills.some((s) => s.id === skill.id);
                return (
                  <Chip
                    key={skill.id}
                    label={skill.name}
                    selected={selected}
                    size="sm"
                    onPress={() => toggleCatalogSkill(skill.id)}
                  />
                );
              })}
            </View>
          )}
        </Card>
      ) : null}

      {/* Manual Custom Skill Input */}
      <Card
        headerTitle="Add a Custom Skill"
        headerSubtitle="Don't see your skill in the catalog? Enter it below (2–40 characters)."
        headerIcon="create-outline"
        style={styles.card}
      >
        <View style={styles.customInputRow}>
          <TextInput
            placeholder={strings.onboarding.addCustomSkillPlaceholder}
            value={customInput}
            onChangeText={handleCustomInputChange}
            maxLength={40}
            error={customInlineError || undefined}
            onSubmitEditing={handleAddCustom}
            returnKeyType="done"
            containerStyle={styles.customInputWrap}
          />
          <Button
            title="Add"
            onPress={handleAddCustom}
            variant="primary"
            size="sm"
            icon="add"
            disabled={!customInput.trim()}
          />
        </View>
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
    padding: 24,
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
  },
  emptySearchBox: {
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  emptySearchText: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
});
