import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAppTheme, useResponsiveLayout } from '../../theme';
import { useAuth } from '../../../hooks/useAuth';
import { applicationsService } from '../../../services/applications';
import { gigsService, GigDetail } from '../../../services/gigs';
import { formatPrice } from '../../../components/ui/GigCard';
import { TextInput } from '../../../components/ui/TextInput';
import { Button } from '../../../components/ui/Button';
import { Card, AlertBox, PageHeaderBox } from '../../../components/ui/Card';
import { showToast } from '../../../components/ui/Toast';
import { mapSqlErrorToFriendlyMessage, strings } from '../../../constants/strings';

export default function ApplyGigScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { isWide, insets } = useResponsiveLayout();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, profile } = useAuth();

  const [gig, setGig] = useState<GigDetail | null>(null);
  const [priceStr, setPriceStr] = useState('');
  const [daysStr, setDaysStr] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = React.useRef(false);

  const minPesos = gig?.price_min ? Math.round(gig.price_min / 100) : null;
  const maxPesos = gig?.price_max ? Math.round(gig.price_max / 100) : null;
  const hasRange = minPesos !== null && maxPesos !== null && maxPesos > minPesos;
  const midPesos =
    hasRange && minPesos !== null && maxPesos !== null
      ? Math.round((minPesos + maxPesos) / 2)
      : null;

  const isOwner = Boolean(gig && user && gig.client_id === user.id);

  useEffect(() => {
    if (!id) return;
    let active = true;
    gigsService
      .getGig(id)
      .then((data) => {
        if (active && data) setGig(data);
      })
      .catch(() => {
        // non-blocking
      });
    return () => {
      active = false;
    };
  }, [id]);

  const handleSubmit = async () => {
    if (!id || inFlightRef.current || loading || submitted || isOwner) return;
    setError(null);

    if (isOwner) {
      setError('You cannot apply to your own gig.');
      return;
    }

    if (profile?.active_mode !== 'find_work') {
      setError('You must be in Find Work mode to submit proposals.');
      return;
    }

    const priceNum = parseFloat(priceStr);
    const daysNum = parseInt(daysStr, 10);

    if (isNaN(priceNum) || priceNum < 100) {
      setError('Proposed price must be at least ₱100.00.');
      return;
    }
    if (isNaN(daysNum) || daysNum <= 0) {
      setError('Please enter estimated days to complete.');
      return;
    }
    if (!message.trim()) {
      setError('Please write a message or proposal for the client.');
      return;
    }

    inFlightRef.current = true;
    setLoading(true);
    try {
      const priceCentavos = Math.round(priceNum * 100);
      await applicationsService.submitApplication({
        gigId: id,
        proposedPrice: priceCentavos,
        estimatedDays: daysNum,
        message: message.trim(),
      });
      setSubmitted(true);
      showToast(strings.toasts.applicationSent);
      router.replace('/(tabs)/activity');
    } catch (err: any) {
      const friendlyMsg = mapSqlErrorToFriendlyMessage(err, 'Failed to submit application.');
      setError(friendlyMsg);
      showToast(friendlyMsg, 'error');
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <PageHeaderBox
        title="Apply for Gig"
        subtitle={gig?.title || 'Submit your proposal & fee in PHP'}
        onBack={() => {
          if (router.canGoBack()) {
            router.back();
          } else if (id) {
            router.replace({ pathname: '/gigs/[id]', params: { id } });
          } else {
            router.replace('/(tabs)/gigs');
          }
        }}
        maxWidth={680}
      />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: !isWide ? Math.max(insets.bottom + 80, 96) : Math.max(insets.bottom + 32, 40) },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.formContainer}>
          {isOwner && (
            <AlertBox
              tone="warning"
              title="Your Gig"
              message="You are the client who posted this gig. You cannot submit an application to your own gig."
              style={{ marginBottom: 16 }}
            />
          )}

          {error && (
            <AlertBox tone="danger" message={error} style={{ marginBottom: 16 }} />
          )}

          {gig && (
            <Card
              tone="outline"
              padding="md"
              accentColor={theme.colors.primary}
              style={{ marginBottom: 16 }}
            >
              <Text style={[styles.gigSummaryTitle, { color: theme.colors.text }]}>
                {gig.title}
              </Text>
              <View style={styles.gigSummaryMetaRow}>
                <View style={[styles.gigSummaryChip, { backgroundColor: theme.colors.surface }]}>
                  <Text style={[styles.gigSummaryChipLabel, { color: theme.colors.muted }]}>
                    Client Budget:
                  </Text>
                  <Text style={[styles.gigSummaryChipValue, { color: theme.colors.text }]}>
                    {formatPrice(gig.price_min)}
                    {gig.price_max && gig.price_max > gig.price_min
                      ? ` – ${formatPrice(gig.price_max)}`
                      : ''}
                  </Text>
                </View>
                {gig.category_name && (
                  <View style={[styles.gigSummaryChip, { backgroundColor: theme.colors.surface }]}>
                    <Text style={[styles.gigSummaryChipLabel, { color: theme.colors.muted }]}>
                      Category:
                    </Text>
                    <Text style={[styles.gigSummaryChipValue, { color: theme.colors.text }]}>
                      {gig.category_name}
                    </Text>
                  </View>
                )}
                {gig.deadline && (
                  <View style={[styles.gigSummaryChip, { backgroundColor: theme.colors.surface }]}>
                    <Text style={[styles.gigSummaryChipLabel, { color: theme.colors.muted }]}>
                      Target Date:
                    </Text>
                    <Text style={[styles.gigSummaryChipValue, { color: theme.colors.text }]}>
                      {new Date(gig.deadline).toLocaleDateString()}
                    </Text>
                  </View>
                )}
              </View>
            </Card>
          )}

          <AlertBox
            tone="info"
            title="Proposal Guidelines"
            message="State your total proposed fee in PHP and estimated delivery time. You can only submit one application per gig."
            style={{ marginBottom: 16 }}
          />

          <Card
            tone="raised"
            padding="lg"
            headerTitle="Your Proposal"
            headerSubtitle="Set your rate, timeline, and cover note"
            headerIcon="paper-plane-outline"
          >
            <View style={isWide ? styles.twoColRow : undefined}>
              <View style={isWide ? styles.colHalf : undefined}>
                <TextInput
                  label="Proposed Fee (₱) *"
                  placeholder="1500"
                  prefixText="₱"
                  value={priceStr}
                  onChangeText={setPriceStr}
                  keyboardType="numeric"
                  helperText="Total amount you expect to receive"
                />

                {minPesos !== null && minPesos > 0 && (
                  <View style={styles.quickFillContainer}>
                    <Text style={[styles.quickFillLabel, { color: theme.colors.muted }]}>
                      Quick-fill from budget:
                    </Text>
                    <View style={styles.quickFillRow}>
                      <Pressable
                        style={({ pressed }) => [
                          styles.quickChip,
                          {
                            backgroundColor:
                              priceStr === String(minPesos)
                                ? theme.colors.primarySoft
                                : theme.colors.surfaceAlt,
                            borderColor:
                              priceStr === String(minPesos)
                                ? theme.colors.primary
                                : theme.colors.border,
                            opacity: pressed ? 0.7 : 1,
                          },
                        ]}
                        onPress={() => setPriceStr(String(minPesos))}
                        accessibilityRole="button"
                        accessibilityLabel={`Set fee to minimum budget ₱${minPesos}`}
                      >
                        <Text
                          style={[
                            styles.quickChipText,
                            {
                              color:
                                priceStr === String(minPesos)
                                  ? theme.colors.primary
                                  : theme.colors.text,
                            },
                          ]}
                        >
                          {hasRange ? `Min ₱${minPesos.toLocaleString()}` : `₱${minPesos.toLocaleString()}`}
                        </Text>
                      </Pressable>

                      {midPesos !== null && (
                        <Pressable
                          style={({ pressed }) => [
                            styles.quickChip,
                            {
                              backgroundColor:
                                priceStr === String(midPesos)
                                  ? theme.colors.primarySoft
                                  : theme.colors.surfaceAlt,
                              borderColor:
                                priceStr === String(midPesos)
                                  ? theme.colors.primary
                                  : theme.colors.border,
                              opacity: pressed ? 0.7 : 1,
                            },
                          ]}
                          onPress={() => setPriceStr(String(midPesos))}
                          accessibilityRole="button"
                          accessibilityLabel={`Set fee to midpoint budget ₱${midPesos}`}
                        >
                          <Text
                            style={[
                              styles.quickChipText,
                              {
                                color:
                                  priceStr === String(midPesos)
                                    ? theme.colors.primary
                                    : theme.colors.text,
                              },
                            ]}
                          >
                            Mid ₱{midPesos.toLocaleString()}
                          </Text>
                        </Pressable>
                      )}

                      {hasRange && maxPesos !== null && (
                        <Pressable
                          style={({ pressed }) => [
                            styles.quickChip,
                            {
                              backgroundColor:
                                priceStr === String(maxPesos)
                                  ? theme.colors.primarySoft
                                  : theme.colors.surfaceAlt,
                              borderColor:
                                priceStr === String(maxPesos)
                                  ? theme.colors.primary
                                  : theme.colors.border,
                              opacity: pressed ? 0.7 : 1,
                            },
                          ]}
                          onPress={() => setPriceStr(String(maxPesos))}
                          accessibilityRole="button"
                          accessibilityLabel={`Set fee to maximum budget ₱${maxPesos}`}
                        >
                          <Text
                            style={[
                              styles.quickChipText,
                              {
                                color:
                                  priceStr === String(maxPesos)
                                    ? theme.colors.primary
                                    : theme.colors.text,
                              },
                            ]}
                          >
                            Max ₱{maxPesos.toLocaleString()}
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                )}
              </View>
              <View style={isWide ? styles.colHalf : undefined}>
                <TextInput
                  label="Estimated Days to Complete *"
                  placeholder="e.g. 5"
                  leftIcon="calendar-outline"
                  value={daysStr}
                  onChangeText={setDaysStr}
                  keyboardType="numeric"
                  helperText="Expected delivery timeframe"
                />
              </View>
            </View>

            <TextInput
              label="Cover Note / Message *"
              placeholder="Explain your approach, experience, and why you are the best fit for this project..."
              value={message}
              onChangeText={setMessage}
              multiline
              numberOfLines={5}
              style={{ minHeight: 110 }}
              maxLength={1000}
              showCharCount
            />

            {isWide && (
              <Button
                title={isOwner ? 'Cannot Apply to Own Gig' : 'Submit Application'}
                rightIcon="send"
                onPress={handleSubmit}
                variant="primary"
                loading={loading}
                disabled={isOwner || loading}
                style={{ marginTop: 12 }}
              />
            )}
          </Card>
        </View>
      </ScrollView>

      {!isWide && (
        <View
          style={[
            styles.stickyDock,
            {
              backgroundColor: theme.colors.surface,
              borderTopColor: theme.colors.border,
              paddingBottom: Math.max(insets.bottom, 12),
            },
          ]}
        >
          <Button
            title={isOwner ? 'Cannot Apply to Own Gig' : 'Submit Application'}
            rightIcon="send"
            onPress={handleSubmit}
            variant="primary"
            loading={loading}
            disabled={isOwner || loading}
            fullWidth
          />
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 32,
  },
  stickyDock: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    width: '100%',
  },
  formContainer: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
  },
  gigSummaryTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 10,
  },
  gigSummaryMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  gigSummaryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  gigSummaryChipLabel: {
    fontSize: 12,
  },
  gigSummaryChipValue: {
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  twoColRow: {
    flexDirection: 'row',
    gap: 14,
  },
  colHalf: {
    flex: 1,
  },
  quickFillContainer: {
    marginTop: -4,
    marginBottom: 14,
  },
  quickFillLabel: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 6,
  },
  quickFillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickChipText: {
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
