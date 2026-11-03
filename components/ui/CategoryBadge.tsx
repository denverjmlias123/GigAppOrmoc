import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import {
  Wrench,
  Palette,
  Code2,
  Camera,
  GraduationCap,
  FileSpreadsheet,
  Truck,
  Utensils,
  Briefcase,
} from 'lucide-react-native';
import { getCategoryMeta, borderRadius } from '../../lib/theme';

export function renderCategoryIcon(
  category?: string | null,
  size: number = 13,
  overrideColor?: string
) {
  const meta = getCategoryMeta(category);
  const color = overrideColor || meta.color;

  switch (category) {
    case 'Home Repair':
      return <Wrench size={size} color={color} />;
    case 'Graphic Design':
      return <Palette size={size} color={color} />;
    case 'Web & IT Support':
      return <Code2 size={size} color={color} />;
    case 'Event Photography':
      return <Camera size={size} color={color} />;
    case 'Academic Tutoring':
      return <GraduationCap size={size} color={color} />;
    case 'Bookkeeping & Admin':
      return <FileSpreadsheet size={size} color={color} />;
    case 'Delivery & Errands':
      return <Truck size={size} color={color} />;
    case 'Catering & Culinary':
      return <Utensils size={size} color={color} />;
    default:
      return <Briefcase size={size} color={color} />;
  }
}

export interface CategoryBadgeProps {
  category?: string | null;
  size?: 'sm' | 'md';
}

export const CategoryBadge: React.FC<CategoryBadgeProps> = ({
  category,
  size = 'md',
}) => {
  const meta = getCategoryMeta(category);
  const iconSize = size === 'sm' ? 11 : 13;

  return (
    <View
      style={[
        styles.badge,
        size === 'sm' && styles.badgeSm,
        {
          backgroundColor: meta.surface,
          borderColor: meta.border,
        },
      ]}
    >
      {renderCategoryIcon(category, iconSize, meta.color)}
      <Text
        style={[
          styles.label,
          size === 'sm' && styles.labelSm,
          { color: meta.badgeText },
        ]}
      >
        {meta.label}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  badgeSm: {
    paddingVertical: 2.5,
    paddingHorizontal: 8,
    gap: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  labelSm: {
    fontSize: 10,
  },
});

export default CategoryBadge;
