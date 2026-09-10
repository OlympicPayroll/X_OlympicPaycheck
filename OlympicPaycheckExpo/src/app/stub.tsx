import { router, useLocalSearchParams } from 'expo-router';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useCombinedStub, useEmailStub, useMarkPaycheckRead, useStub } from '@/api/queries';
import { messageFor, type LineItem } from '@/api/types';
import { FamilyHeader, PageTitle, TitleIconButton } from '@/components/app-bar';
import { Mail } from '@/components/icons';
import { CardSkeleton, ErrorState, ListSkeleton } from '@/components/states';
import { Card } from '@/components/ui';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDialog } from '@/lib/dialog';
import { usd } from '@/lib/format';
import type { StubParams } from '@/lib/routes';

export default function StubScreen() {
  const theme = useTheme();
  const { confirm } = useDialog();
  const params = useLocalSearchParams<StubParams>();
  const [tab, setTab] = useState<'check' | 'ytd'>('check');

  const isCombined = params.combined === '1';
  const single = useStub(isCombined ? undefined : params.id);
  const combined = useCombinedStub(isCombined ? params.date : undefined);
  const query = isCombined ? combined : single;
  const stub = query.data;

  const markRead = useMarkPaycheckRead();
  const emailStub = useEmailStub();

  /**
   * The delivery id.
   *
   * Deliberately not `params.sentId ?? params.id`: a pay-period id and a
   * delivery id are different namespaces in the payroll API, and substituting
   * one for the other only "worked" because both happen to be strings. A
   * payroll with no delivery has no delivery to mark read or re-send, and the
   * UI needs to say so rather than send the server a plausible wrong id.
   */
  const sentId = params.sentId;

  // Opening an unread payroll clears its NEW badge, matching the legacy app.
  useEffect(() => {
    if (sentId && stub) markRead.mutate({ sentId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentId, stub?.id]);

  const canEmail = !!sentId && !!stub;

  /**
   * Held for the whole email interaction (confirmation, send, and any
   * retries), not only while the request is in flight. `isPending` is false
   * while a dialog is up, so a second tap during the confirmation opened a
   * second one and could send the stub twice.
   */
  const emailingRef = useRef(false);
  const [emailing, setEmailing] = useState(false);

  const onEmail = async () => {
    if (!sentId || emailingRef.current) return;
    emailingRef.current = true;
    setEmailing(true);

    try {
      const ok = await confirm({
        title: 'Email this pay stub?',
        message: 'We’ll send a copy to the email address on your payroll record.',
        confirmText: 'Send',
      });
      if (!ok) return;

      // Every retry behaves like the first attempt: confirm on success, offer
      // another go on failure. A rejected send used to close the sheet and say
      // nothing at all.
      for (;;) {
        try {
          await emailStub.mutateAsync({ sentId });
        } catch (error) {
          const retry = await confirm({
            title: 'We couldn’t send it',
            message: messageFor(error),
            confirmText: 'Try Again',
            cancelText: 'Close',
          });
          if (retry) continue;
          return;
        }
        await confirm({ title: 'Pay stub sent', confirmText: 'Done', cancelText: 'Close' });
        return;
      }
    } finally {
      emailingRef.current = false;
      setEmailing(false);
    }
  };

  /**
   * Only claim a deposit when the money was actually deposited. Bonus runs are
   * often paper checks, and "NET PAY DEPOSITED" on one is simply untrue.
   */
  const method = stub?.method ?? params.method;
  const netLabel = method && /deposit/i.test(method) ? 'NET PAY DEPOSITED' : 'NET PAY';

  return (
    <View style={{ flex: 1, backgroundColor: theme.ground }}>
      <FamilyHeader />

      <ScrollView contentContainerStyle={styles.content}>
        <PageTitle
          title="Pay Stub"
          onBack={() => router.back()}
          right={
            // Hidden until there is a delivery to re-send and a stub to send:
            // offering the action and then failing is worse than not offering.
            canEmail ? (
              // The interaction outlives the tap (dialogs, the send, retries),
              // so the button starts it without waiting on it.
              <TitleIconButton label="Email a copy" onPress={() => void onEmail()} disabled={emailing}>
                <Mail color={emailing ? theme.faint : theme.brand} size={18} />
              </TitleIconButton>
            ) : undefined
          }
        />

        <View style={styles.pad}>
          {query.isPending && (
            <>
              <CardSkeleton />
              <View style={{ height: Spacing.four }} />
              <ListSkeleton rows={4} />
            </>
          )}

          {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}

          {stub && (
            <>
              <Animated.View entering={FadeInDown.duration(320)}>
                <Card style={styles.hero}>
                  <Text style={[Type.caption, { color: theme.textSecondary }]}>{stub.payDate}</Text>
                  <Text style={[styles.heroNet, { color: theme.money }]}>
                    {usd(tab === 'check' ? stub.net : stub.ytd.net)}
                  </Text>
                  <Text style={[Type.overline, { color: theme.faint, marginTop: 5 }]}>
                    {tab === 'check' ? netLabel : 'NET PAY THIS YEAR'}
                  </Text>
                </Card>
              </Animated.View>

              <View style={[styles.seg, { backgroundColor: theme.sketchTint }]}>
                {(['check', 'ytd'] as const).map((t) => {
                  const active = tab === t;
                  return (
                    <Pressable
                      key={t}
                      onPress={() => setTab(t)}
                      accessibilityRole="button"
                      accessibilityState={active ? { selected: true } : {}}
                      style={[styles.segItem, active && { backgroundColor: theme.surface }]}
                    >
                      <Text style={[Type.callout, { color: active ? theme.brand : theme.textSecondary }]}>
                        {t === 'check' ? 'This check' : 'Year to date'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {tab === 'check' ? (
                <>
                  <Section title="Earnings">
                    {stub.earnings.map((e) => (
                      <Line key={e.label} item={e} />
                    ))}
                    <View style={[styles.line, styles.rowBetween, { backgroundColor: theme.rowFill }]}>
                      <Text style={[Type.callout, { color: theme.ink, fontWeight: '600' }]}>Gross pay</Text>
                      <Text style={[styles.amt, { color: theme.ink, fontWeight: '700' }]}>{usd(stub.gross)}</Text>
                    </View>
                  </Section>

                  <Section title="Taxes">
                    {stub.taxes.map((t) => (
                      <Line key={t.label} item={t} negative />
                    ))}
                  </Section>

                  <Section title="Deductions">
                    {stub.deductions.map((d) => (
                      <Line key={d.label} item={d} negative />
                    ))}
                  </Section>

                  <Summary
                    gross={stub.gross}
                    taxes={stub.taxTotal}
                    deductions={stub.deductionTotal}
                    net={stub.net}
                    label="Net pay"
                  />
                </>
              ) : (
                <>
                  <Section title="Year to date">
                    <Line item={{ label: 'Gross earnings', amount: stub.ytd.gross }} />
                    <Line item={{ label: 'Taxes withheld', amount: stub.ytd.taxes }} negative />
                    <Line item={{ label: 'Deductions', amount: stub.ytd.deductions }} negative />
                  </Section>

                  <Summary
                    gross={stub.ytd.gross}
                    taxes={stub.ytd.taxes}
                    deductions={stub.ytd.deductions}
                    net={stub.ytd.net}
                    label="Net pay this year"
                  />
                </>
              )}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <>
      <Text style={[Type.headline, { color: theme.ink, marginTop: Spacing.four, marginBottom: Spacing.two }]}>{title}</Text>
      <Card style={{ overflow: 'hidden' }}>{children}</Card>
    </>
  );
}

function Line({ item, negative }: { item: LineItem; negative?: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.line, styles.rowBetween]}>
      <View style={{ flex: 1 }}>
        <Text style={[Type.body, { color: theme.ink }]}>{item.label}</Text>
        {item.detail && <Text style={[Type.caption, { color: theme.textSecondary }]}>{item.detail}</Text>}
      </View>
      <Text style={[styles.amt, { color: negative ? theme.textSecondary : theme.ink }]}>
        {negative ? '−' : ''}
        {usd(item.amount)}
      </Text>
    </View>
  );
}

function Summary({
  gross,
  taxes,
  deductions,
  net,
  label,
}: {
  gross: number;
  taxes: number;
  deductions: number;
  net: number;
  label: string;
}) {
  const theme = useTheme();
  return (
    <Card style={[styles.summary, { backgroundColor: theme.moneyTint, borderColor: theme.moneyBright }]}>
      <SummaryRow label="Gross" value={usd(gross)} />
      <SummaryRow label="Taxes" value={`−${usd(taxes)}`} />
      <SummaryRow label="Deductions" value={`−${usd(deductions)}`} />
      <View style={[styles.summaryDivide, { backgroundColor: theme.line }]} />
      <View style={styles.rowBetween}>
        <Text style={[Type.callout, { color: theme.ink, fontWeight: '700' }]}>{label}</Text>
        <Text style={[styles.netTotal, { color: theme.money }]}>{usd(net)}</Text>
      </View>
    </Card>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={styles.rowBetween}>
      <Text style={[Type.caption, { color: theme.textSecondary }]}>{label}</Text>
      <Text style={[styles.amt, { color: theme.ink, fontSize: 13.5 }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: Spacing.six },
  pad: { paddingHorizontal: Spacing.three },
  hero: { alignItems: 'center', paddingVertical: Spacing.four, marginTop: Spacing.two },
  heroNet: { fontSize: 38, fontWeight: '700', letterSpacing: -0.8, marginTop: 6, fontVariant: ['tabular-nums'] },
  seg: { flexDirection: 'row', borderRadius: Radius.pill, padding: 4, marginTop: Spacing.three },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: Radius.pill },
  line: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: Spacing.three },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  amt: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  summary: { marginTop: Spacing.four, padding: Spacing.three, gap: 9 },
  summaryDivide: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
  netTotal: { fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
