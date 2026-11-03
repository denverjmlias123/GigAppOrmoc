import React, { RefObject } from 'react';
import {
  View,
  Text,
  TextInput as RNTextInput,
  StyleSheet,
} from 'react-native';
import { useAppTheme } from '../../app/theme';
import { strings } from '../../constants/strings';
import { Card } from '../ui/Card';
import { TextInput } from '../ui/TextInput';
import { Chip } from '../ui/Chip';
import { Button } from '../ui/Button';

interface FreelancerWorkSectionProps {
  headline: string;
  setHeadline: (val: string) => void;
  headlineInputRef: RefObject<RNTextInput | null>;
  startingRateNote: string;
  setStartingRateNote: (val: string) => void;
  workTypes: string[];
  toggleWorkType: (wt: string) => void;
  availability: 'available_now' | 'part_time' | 'weekends' | 'not_taking_work' | '';
  setAvailability: (val: 'available_now' | 'part_time' | 'weekends' | 'not_taking_work' | '') => void;
  experienceYears: 'lt_1' | '1_3' | '3_5' | '5_plus' | '';
  setExperienceYears: (val: 'lt_1' | '1_3' | '3_5' | '5_plus' | '') => void;
  onNavigatePortfolio: () => void;
  onNavigateSkills?: () => void;
  fieldErrors: Record<string, string>;
}

export const FreelancerWorkSection: React.FC<FreelancerWorkSectionProps> = ({
  headline,
  setHeadline,
  headlineInputRef,
  startingRateNote,
  setStartingRateNote,
  workTypes,
  toggleWorkType,
  availability,
  setAvailability,
  experienceYears,
  setExperienceYears,
  onNavigatePortfolio,
  onNavigateSkills,
  fieldErrors,
}) => {
  const theme = useAppTheme();

  return (
    <Card
      headerTitle="Freelancer Work Details"
      headerIcon="briefcase-outline"
      style={styles.roleSection}
    >
      {/* Headline */}
      <TextInput
        ref={headlineInputRef}
        label="Headline (up to 80 characters)"
        value={headline}
        onChangeText={setHeadline}
        placeholder="e.g. Phone repair and tutoring in Cogon"
        maxLength={80}
        showCharCount
        error={fieldErrors.headline}
        containerStyle={styles.inputGroup}
      />

      {/* Work types offered */}
      <View style={styles.inputGroup}>
        <Text style={[styles.label, { color: theme.colors.text }]}>Work Types Offered</Text>
        <View style={styles.chipsWrap}>
          {strings.profile.workTypeOptions.map((opt) => {
            const selected = workTypes.includes(opt.value);
            return (
              <Chip
                key={opt.value}
                label={opt.label}
                selected={selected}
                onPress={() => toggleWorkType(opt.value)}
                size="sm"
              />
            );
          })}
        </View>
      </View>

      {/* Availability */}
      <View style={styles.inputGroup}>
        <Text style={[styles.label, { color: theme.colors.text }]}>Availability</Text>
        <View style={styles.chipsWrap}>
          {strings.profile.availabilityOptions.map((opt) => {
            const selected = availability === opt.value;
            return (
              <Chip
                key={opt.value}
                label={opt.label}
                selected={selected}
                onPress={() => setAvailability(selected ? '' : opt.value)}
                size="sm"
              />
            );
          })}
        </View>
      </View>

      {/* Years of Experience */}
      <View style={styles.inputGroup}>
        <Text style={[styles.label, { color: theme.colors.text }]}>Years of Experience</Text>
        <View style={styles.chipsWrap}>
          {strings.profile.experienceOptions.map((opt) => {
            const selected = experienceYears === opt.value;
            return (
              <Chip
                key={opt.value}
                label={opt.label}
                selected={selected}
                onPress={() => setExperienceYears(selected ? '' : opt.value)}
                size="sm"
              />
            );
          })}
        </View>
      </View>

      {/* Typical Starting Rate Note */}
      <TextInput
        label="Typical Starting Rate Note (Optional)"
        value={startingRateNote}
        onChangeText={setStartingRateNote}
        placeholder="e.g. Starts at ₱300/session depending on scope"
        maxLength={120}
        error={fieldErrors.startingRateNote}
        containerStyle={styles.inputGroup}
      />

      {/* Quick Links: Portfolio & Skills */}
      <View style={styles.quickLinksRow}>
        <Button
          title="Manage Portfolio Items"
          onPress={onNavigatePortfolio}
          variant="secondary"
          size="sm"
          icon="folder-open-outline"
          rightIcon="arrow-forward"
        />

        {onNavigateSkills ? (
          <Button
            title="Manage Skills"
            onPress={onNavigateSkills}
            variant="secondary"
            size="sm"
            icon="construct-outline"
            rightIcon="arrow-forward"
          />
        ) : null}
      </View>
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
    marginBottom: 8,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickLinksRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4,
  },
});
