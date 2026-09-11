import { router, useLocalSearchParams } from 'expo-router';
import { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { IS_MOCK_BACKEND } from '@/api/client';
import { useW2 } from '@/api/queries';
import type { W2 } from '@/api/types';
import { FamilyHeader, PageTitle, TitleIconButton } from '@/components/app-bar';
import { Download } from '@/components/icons';
import { CardSkeleton, ErrorState, ListSkeleton } from '@/components/states';
import { Card } from '@/components/ui';
import { Radius, Spacing, Type } from '@/constants/theme';
import { usePdfExport } from '@/hooks/use-pdf-export';
import { useTheme } from '@/hooks/use-theme';
import { w2Html } from '@/lib/documents';
import { usd } from '@/lib/format';
import { pdfFileName } from '@/lib/pdf';
import { box12Meaning, box14Meaning } from '@/lib/tax-codes';

/**
 * One W-2, box by box.
 *
 * The form's grid is unreadable at phone width, so the screen groups the boxes
 * by what they are about and keeps each box number beside its figure. The PDF
 * is the form itself (Copies B, C and 2), for filing.
 */
export default function W2Screen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const w2 = useW2(id);
  const form = w2.data;
  const { exporting, exportPdf } = usePdfExport();

  const onDownload = () => {
    if (!form) return;
    void exportPdf({
      html: async () => w2Html({ w2: form, sample: IS_MOCK_BACKEND }),
      fileName: pdfFileName('W-2', form.taxYear, form.employer.name),
      title: `${form.taxYear} W-2`,
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.ground }}>
      <FamilyHeader />

      <ScrollView contentContainerStyle={styles.content}>
        <PageTitle
          title={form ? `${form.taxYear} W-2` : 'W-2'}
          onBack={() => router.back()}
          right={
            form ? (
              <TitleIconButton label="Download PDF" onPress={onDownload} disabled={exporting}>
                <Download color={exporting ? theme.faint : theme.brand} size={18} />
              </TitleIconButton>
            ) : undefined
          }
        />

        <View style={styles.pad}>
          {w2.isPending && (
            <>
              <CardSkeleton />
              <View style={{ height: Spacing.four }} />
              <ListSkeleton rows={5} />
            </>
          )}

          {w2.isError && <ErrorState error={w2.error} onRetry={() => w2.refetch()} />}

          {form && <W2Details form={form} />}
        </View>
      </ScrollView>
    </View>
  );
}

type Line = {
  box: string;
  label: string;
  value: string;
  /** The code or label as printed, when the label above is its plain-English meaning. */
  printed?: string;
  /** Multi-line text (names, addresses) sits under its label rather than beside it. */
  block?: boolean;
};

function W2Details({ form }: { form: W2 }) {
  const theme = useTheme();
  const [firstState] = form.states;

  const federal: Line[] = [
    { box: '1', label: 'Wages, tips, other compensation', value: usd(form.wages) },
    { box: '2', label: 'Federal income tax withheld', value: usd(form.federalIncomeTax) },
    { box: '3', label: 'Social security wages', value: usd(form.socialSecurityWages) },
    { box: '4', label: 'Social security tax withheld', value: usd(form.socialSecurityTax) },
    { box: '5', label: 'Medicare wages and tips', value: usd(form.medicareWages) },
    { box: '6', label: 'Medicare tax withheld', value: usd(form.medicareTax) },
    // Rarely used boxes appear only when they hold something.
    ...(
      [
        ['7', 'Social security tips', form.socialSecurityTips],
        ['8', 'Allocated tips', form.allocatedTips],
        ['10', 'Dependent care benefits', form.dependentCareBenefits],
        ['11', 'Nonqualified plans', form.nonqualifiedPlans],
      ] as const
    )
      .filter(([, , amount]) => amount > 0)
      .map(([box, label, amount]) => ({ box, label, value: usd(amount) })),
  ];

  const box12: Line[] = form.box12.map((entry, i) => {
    const meaning = box12Meaning(entry.code);
    return {
      box: `12${'abcd'[i] ?? ''}`,
      label: meaning ?? `Code ${entry.code}`,
      printed: meaning ? `Code ${entry.code}` : undefined,
      value: usd(entry.amount),
    };
  });

  const box13: Line[] = (
    [
      ['Statutory employee', form.statutoryEmployee],
      ['Retirement plan', form.retirementPlan],
      ['Third-party sick pay', form.thirdPartySickPay],
    ] as const
  )
    .filter(([, checked]) => checked)
    .map(([label]) => ({ box: '13', label, value: 'Checked' }));

  const box14: Line[] = form.box14.map((line) => {
    const meaning = box14Meaning(line.label);
    return { box: '14', label: meaning ?? line.label, printed: meaning ? line.label : undefined, value: usd(line.amount) };
  });

  const employer: Line[] = [
    { box: 'b', label: 'Employer identification number (EIN)', value: form.employer.ein },
    { box: 'c', label: 'Employer’s name and address', value: [form.employer.name, ...form.employer.address].join('\n'), block: true },
    ...(form.controlNumber ? [{ box: 'd', label: 'Control number', value: form.controlNumber }] : []),
  ];

  const employee: Line[] = [
    { box: 'a', label: 'Social security number', value: form.employee.ssnMasked },
    { box: 'e', label: 'Name', value: `${form.employee.firstName} ${form.employee.lastName}` },
    { box: 'f', label: 'Address', value: form.employee.address.join('\n'), block: true },
  ];

  return (
    <Animated.View entering={FadeInDown.duration(320)}>
      <Card style={styles.hero}>
        <Text style={[Type.caption, { color: theme.textSecondary }]}>{form.employer.name}</Text>
        <Text style={[styles.heroFigure, { color: theme.money }]}>{usd(form.wages)}</Text>
        <Text style={[Type.overline, { color: theme.faint, marginTop: 5 }]}>TAXABLE WAGES · BOX 1</Text>

        <View style={[styles.heroSplit, { borderTopColor: theme.line }]}>
          <HeroFigure label="Federal tax withheld" value={usd(form.federalIncomeTax)} />
          {firstState && <HeroFigure label={`${firstState.state} tax withheld`} value={usd(firstState.incomeTax)} />}
        </View>
      </Card>

      <Section title="Federal">
        <Lines lines={federal} />
      </Section>

      {box12.length > 0 && (
        <Section title="Box 12">
          <Lines lines={box12} />
        </Section>
      )}

      {box13.length > 0 && (
        <Section title="Box 13">
          <Lines lines={box13} />
        </Section>
      )}

      {box14.length > 0 && (
        <Section title="Box 14 · Other">
          <Lines lines={box14} />
        </Section>
      )}

      {form.states.map((state) => (
        <Section key={`${state.state}-${state.employerStateId}`} title={`State · ${state.state}`}>
          <Lines
            lines={[
              { box: '15', label: 'Employer’s state ID number', value: state.employerStateId },
              { box: '16', label: 'State wages, tips, etc.', value: usd(state.wages) },
              { box: '17', label: 'State income tax', value: usd(state.incomeTax) },
              ...(state.localWages ? [{ box: '18', label: 'Local wages, tips, etc.', value: usd(state.localWages) }] : []),
              ...(state.localIncomeTax
                ? [{ box: '19', label: 'Local income tax', value: usd(state.localIncomeTax) }]
                : []),
              ...(state.locality ? [{ box: '20', label: 'Locality name', value: state.locality }] : []),
            ]}
          />
        </Section>
      ))}

      <Section title="Employer">
        <Lines lines={employer} />
      </Section>

      <Section title="Employee">
        <Lines lines={employee} />
      </Section>

      <Text style={[Type.caption, { color: theme.faint, marginTop: Spacing.three }]}>
        For your security, only the last four digits of your Social Security number are shown. Download the PDF for the
        complete form, with Copies B, C and 2 for your tax returns.
      </Text>
    </Animated.View>
  );
}

function HeroFigure({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={[styles.splitValue, { color: theme.ink }]}>{value}</Text>
      <Text style={[Type.caption, { color: theme.textSecondary, marginTop: 2 }]}>{label}</Text>
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

function Lines({ lines }: { lines: Line[] }) {
  const theme = useTheme();
  return (
    <>
      {lines.map((line, i) => (
        <View key={`${line.box}-${line.label}`}>
          {i > 0 && <View style={[styles.divider, { backgroundColor: theme.line }]} />}
          <View style={[styles.line, line.block && { alignItems: 'flex-start' }]}>
            <View style={[styles.badge, { backgroundColor: theme.sketchTint }]}>
              <Text style={[styles.badgeText, { color: theme.brand }]}>{line.box}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[Type.body, { color: theme.ink }]}>{line.label}</Text>
              {line.printed && <Text style={[Type.caption, { color: theme.textSecondary }]}>{line.printed}</Text>}
              {line.block && <Text style={[Type.body, { color: theme.textSecondary, marginTop: 2 }]}>{line.value}</Text>}
            </View>
            {!line.block && <Text style={[styles.amount, { color: theme.ink }]}>{line.value}</Text>}
          </View>
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: Spacing.six },
  pad: { paddingHorizontal: Spacing.three },
  hero: { alignItems: 'center', paddingTop: Spacing.four, paddingBottom: Spacing.three, marginTop: Spacing.two },
  heroFigure: { fontSize: 36, fontWeight: '700', letterSpacing: -0.8, marginTop: 6, fontVariant: ['tabular-nums'] },
  heroSplit: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    marginTop: Spacing.three,
    paddingTop: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  splitValue: { fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'] },
  line: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: Spacing.three },
  badge: { minWidth: 30, height: 26, paddingHorizontal: 6, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 12.5, fontWeight: '800' },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.three },
  amount: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
