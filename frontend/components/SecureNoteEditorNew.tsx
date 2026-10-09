import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput as RNTextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card.native';
import { Badge } from './ui/badge.native';
import { Alert } from './ui/alert.native';
import { Button } from './ui/button.native';
import { useToast } from './ui/toast.native';
import { P } from '../constants/permissions';
import { useAuth } from '../context/AuthContext';
import { useStepUp } from '../context/StepUpContext';
import { ApiError, NoteContent, NoteDetail, therapyNoteAPI } from '../services/api';
import { useDialog } from './common/dialogs';
import { OptionPicker, PatientPicker } from './common/forms';
import { formatDate, formatDateTime, isValidDateString, localDate } from './common/format';
import { useErrorToast } from './common/hooks';
import { ErrorView, LoadingView, ScreenHeader } from './common/layout';

interface SecureNoteEditorNewProps {
  navigation: any;
  route: any;
}

const NOTE_TYPES = ['Session Note', 'Individual Therapy', 'Group Therapy', 'Family Therapy', 'Assessment', 'Consultation', 'Progress Note'];
const MOODS = ['Stable', 'Anxious', 'Depressed', 'Agitated', 'Elevated', 'Withdrawn'];
const AUTO_LOCK_SECONDS = 300;

const EMPTY: NoteContent = { mood: '', symptoms: '', interventions: '', treatment_plan: '', notes: '', next_session: '' };

/**
 * Create, read and edit an encrypted therapy note. Reading/editing requires a recent
 * re-authentication; the note view locks itself after 5 minutes without interaction.
 */
export function SecureNoteEditorNew({ navigation, route }: SecureNoteEditorNewProps) {
  const noteId: number | undefined = route.params?.noteId ? Number(route.params.noteId) : undefined;
  const initialPatient: number | undefined = route.params?.patientId ? Number(route.params.patientId) : undefined;
  const isNew = !noteId;
  const { can, user } = useAuth();
  const { withStepUp } = useStepUp();
  const { confirm } = useDialog();
  const { showToast } = useToast();
  const showError = useErrorToast();

  const [patientId, setPatientId] = useState<number | null>(initialPatient ?? null);
  const [note, setNote] = useState<NoteDetail | null>(null);
  const [noteType, setNoteType] = useState('Session Note');
  const [sessionDate, setSessionDate] = useState(localDate());
  const [content, setContent] = useState<NoteContent>(EMPTY);
  const [original, setOriginal] = useState<string>(JSON.stringify(EMPTY));
  const [editing, setEditing] = useState(isNew);
  const [changeSummary, setChangeSummary] = useState('');
  const [loading, setLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<any[] | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(AUTO_LOCK_SECONDS);
  const [locked, setLocked] = useState(false);

  const dirty = useMemo(() => JSON.stringify(content) !== original, [content, original]);

  const load = async () => {
    if (!noteId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const { data } = await withStepUp(() => therapyNoteAPI.getById(noteId), 'Therapy notes are encrypted. Re-enter your password to decrypt this note.');
      setNote(data);
      setPatientId(data.patient_id);
      setNoteType(data.note_type);
      setSessionDate(data.session_date ?? localDate());
      const loaded = { ...EMPTY, ...data.content };
      setContent(loaded);
      setOriginal(JSON.stringify(loaded));
      setLocked(false);
      setSecondsLeft(AUTO_LOCK_SECONDS);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : 'Could not open note');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  // Auto-lock decrypted content after inactivity on this screen.
  useEffect(() => {
    if (isNew || !note || locked) return undefined;
    const timer = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          setLocked(true);
          setContent(EMPTY);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isNew, note, locked]);

  const touch = () => setSecondsLeft(AUTO_LOCK_SECONDS);
  const set = (key: keyof NoteContent) => (value: string) => {
    touch();
    setContent((current) => ({ ...current, [key]: value }));
  };

  const payloadContent = () => {
    const cleaned: NoteContent = {};
    for (const [key, value] of Object.entries(content)) {
      if (typeof value === 'string' && value.trim()) cleaned[key as keyof NoteContent] = value.trim();
    }
    return cleaned;
  };

  const save = async () => {
    const cleaned = payloadContent();
    if (!patientId) return showToast('Select a patient first', 'warning');
    if (Object.keys(cleaned).length === 0) return showToast('The note is empty', 'warning');
    if (!isValidDateString(sessionDate)) return showToast('Session date must be YYYY-MM-DD', 'warning');
    setSaving(true);
    try {
      if (isNew) {
        await therapyNoteAPI.create({ patient_id: patientId, note_type: noteType, session_date: sessionDate, content: cleaned });
        showToast('Note encrypted and saved', 'success');
        navigation.goBack();
      } else {
        const { data } = await withStepUp(() =>
          therapyNoteAPI.update(noteId!, { note_type: noteType, session_date: sessionDate, content: cleaned, change_summary: changeSummary.trim() || undefined }),
        );
        showToast(`Saved as version ${data.version} (previous version kept)`, 'success');
        setEditing(false);
        setChangeSummary('');
        setHistory(null);
        await load();
      }
    } catch (e) {
      showError(e);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!note) return;
    if (!(await confirm({ title: 'Delete this note permanently?', message: 'All versions will be removed. This is recorded in the audit log.', confirmText: 'Delete', destructive: true }))) return;
    try {
      await withStepUp(() => therapyNoteAPI.delete(note.id));
      showToast('Note deleted', 'success');
      navigation.goBack();
    } catch (e) {
      showError(e);
    }
  };

  const showHistory = async () => {
    if (history) return setHistory(null);
    try {
      const { data } = await therapyNoteAPI.versions(noteId!);
      setHistory(data.history);
    } catch (e) {
      showError(e);
    }
  };

  const leave = async () => {
    if (editing && dirty && !(await confirm({ title: 'Discard changes?', message: 'Unsaved changes will be lost.', confirmText: 'Discard', destructive: true }))) return;
    navigation.goBack();
  };

  if (!isNew && !can(P.NOTES_READ) && !can(P.NOTES_EMERGENCY)) {
    return (
      <SafeAreaView style={styles.container}>
        <ScreenHeader title="Therapy note" onBack={() => navigation.goBack()} />
        <ErrorView message="Your role cannot read therapy notes." />
      </SafeAreaView>
    );
  }

  const readOnly = !editing;
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = String(secondsLeft % 60).padStart(2, '0');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title={isNew ? 'New session note' : editing ? 'Edit session note' : note?.note_type ?? 'Therapy note'}
        subtitle={note ? `${note.patient_name} · ${note.patient_mrn}` : `${user?.role_name ?? ''} · ${user?.name ?? ''}`}
        onBack={leave}
        right={<Badge variant="outline">🔒 Encrypted</Badge>}
      />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" onTouchStart={touch}>
        {loading ? <LoadingView label="Decrypting note…" /> : null}
        {loadError ? <ErrorView message={loadError} onRetry={load} /> : null}

        {locked ? (
          <Card style={styles.card}>
            <CardContent style={styles.lockedContent}>
              <Text style={styles.lockedIcon}>🔒</Text>
              <Text style={styles.lockedText}>Note locked after 5 minutes of inactivity.</Text>
              <Button onPress={load} style={styles.lockedButton}>
                Re-authenticate to unlock
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {!loading && !loadError && !locked ? (
          <>
            <Alert
              variant="destructive"
              title="Security notice"
              description={
                isNew
                  ? 'This note is encrypted before it is stored. Do not copy clinical content outside NeuroLock.'
                  : `Decrypted for you only. This view locks in ${minutes}:${seconds} without interaction.`
              }
              style={styles.card}
            />

            {note ? (
              <View style={styles.versionInfo}>
                <View style={styles.versionHeader}>
                  <Text style={styles.versionText}>
                    📜 Version {note.version} · by {note.author_name} · updated {formatDateTime(note.updated_at)}
                  </Text>
                  <TouchableOpacity onPress={showHistory}>
                    <Text style={styles.versionButton}>{history ? 'Hide history' : 'View history'}</Text>
                  </TouchableOpacity>
                </View>
                {history ? (
                  history.length === 0 ? (
                    <Text style={styles.versionItemChanges}>No earlier versions.</Text>
                  ) : (
                    history.map((version) => (
                      <View key={version.id} style={styles.versionItem}>
                        <Text style={styles.versionItemVersion}>
                          Version {version.version} · replaced {formatDateTime(version.created_at)}
                        </Text>
                        <Text style={styles.versionItemChanges}>
                          {version.change_summary ?? 'No summary'} — edited by {version.edited_by_name ?? 'unknown'}
                        </Text>
                      </View>
                    ))
                  )
                ) : null}
              </View>
            ) : null}

            <Card style={styles.card}>
              <CardHeader>
                <CardTitle>Session information</CardTitle>
              </CardHeader>
              <CardContent>
                {isNew && !initialPatient ? <PatientPicker value={patientId} onChange={(p) => setPatientId(p.id)} /> : null}
                <Text style={styles.inputLabel}>Session date</Text>
                <RNTextInput style={[styles.input, readOnly && styles.readOnly]} value={sessionDate} onChangeText={setSessionDate} placeholder="YYYY-MM-DD" editable={!readOnly} />
                {readOnly ? (
                  <Text style={styles.readValue}>
                    {noteType} · {formatDate(sessionDate)}
                  </Text>
                ) : (
                  <OptionPicker label="Note type" options={NOTE_TYPES} value={noteType} onChange={setNoteType} />
                )}
              </CardContent>
            </Card>

            <Card style={styles.card}>
              <CardHeader>
                <CardTitle>Clinical assessment</CardTitle>
              </CardHeader>
              <CardContent>
                {readOnly ? (
                  <ReadField label="Patient mood / affect" value={content.mood} />
                ) : (
                  <OptionPicker label="Patient mood / affect" options={MOODS} value={content.mood ?? ''} onChange={set('mood')} />
                )}
                <EditableArea label="Current symptoms" value={content.symptoms} onChange={set('symptoms')} readOnly={readOnly} placeholder="Symptoms, behaviours and observations…" />
              </CardContent>
            </Card>

            <Card style={styles.card}>
              <CardHeader>
                <CardTitle>Treatment & interventions</CardTitle>
              </CardHeader>
              <CardContent>
                <EditableArea label="Interventions used" value={content.interventions} onChange={set('interventions')} readOnly={readOnly} placeholder="Techniques and approaches used…" />
                <EditableArea label="Treatment plan updates" value={content.treatment_plan} onChange={set('treatment_plan')} readOnly={readOnly} placeholder="Changes to goals and recommendations…" />
              </CardContent>
            </Card>

            <Card style={styles.card}>
              <CardHeader>
                <CardTitle>Additional notes</CardTitle>
              </CardHeader>
              <CardContent>
                <EditableArea label="Session notes" value={content.notes} onChange={set('notes')} readOnly={readOnly} placeholder="Observations, patient feedback…" />
                <EditableArea label="Next session plan" value={content.next_session} onChange={set('next_session')} readOnly={readOnly} placeholder="Date and plan for next session…" single />
              </CardContent>
            </Card>

            {editing && !isNew ? (
              <Card style={styles.card}>
                <CardContent>
                  <Text style={styles.inputLabel}>Change summary (optional)</Text>
                  <RNTextInput style={styles.input} value={changeSummary} onChangeText={setChangeSummary} placeholder="e.g. Updated treatment plan" maxLength={255} />
                </CardContent>
              </Card>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      {!loading && !loadError && !locked ? (
        <View style={styles.actionButtons}>
          {editing ? (
            <View style={styles.buttonRow}>
              <Button variant="outline" onPress={isNew ? leave : () => { setContent(JSON.parse(original)); setEditing(false); }} style={styles.flexButton}>
                Cancel
              </Button>
              <Button onPress={save} disabled={saving || (!isNew && !dirty)} loading={saving} style={styles.flexButton}>
                💾 Save note
              </Button>
            </View>
          ) : (
            <View style={styles.buttonRow}>
              {note?.can_edit ? (
                <Button onPress={() => setEditing(true)} style={styles.flexButton}>
                  ✏️ Edit
                </Button>
              ) : null}
              {can(P.NOTES_DELETE) ? (
                <Button variant="destructive" onPress={remove} style={styles.flexButton}>
                  Delete
                </Button>
              ) : null}
              <Button variant="outline" onPress={() => navigation.goBack()} style={styles.flexButton}>
                Close
              </Button>
            </View>
          )}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function ReadField({ label, value }: { label: string; value?: string }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.inputLabel}>{label}</Text>
      <Text style={styles.readValue}>{value?.trim() ? value : '—'}</Text>
    </View>
  );
}

function EditableArea({
  label,
  value,
  onChange,
  readOnly,
  placeholder,
  single,
}: {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  placeholder: string;
  single?: boolean;
}) {
  if (readOnly) return <ReadField label={label} value={value} />;
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.inputLabel}>{label}</Text>
      <RNTextInput
        value={value ?? ''}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#9ca3af"
        multiline={!single}
        numberOfLines={single ? 1 : 4}
        style={[styles.input, !single && styles.textArea]}
        textAlignVertical="top"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  scrollView: { flex: 1 },
  content: { padding: 16, paddingBottom: 32, maxWidth: 820, width: '100%', alignSelf: 'center' },
  card: { marginBottom: 14 },
  inputLabel: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: '#111827', backgroundColor: '#fff', marginBottom: 12 },
  readOnly: { backgroundColor: '#f3f4f6', color: '#6b7280' },
  textArea: { minHeight: 100 },
  readValue: { fontSize: 15, color: '#111827', lineHeight: 22 },
  versionInfo: { backgroundColor: '#eff6ff', borderRadius: 10, padding: 12, marginBottom: 14 },
  versionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  versionText: { fontSize: 13, color: '#1e3a8a', flex: 1 },
  versionButton: { fontSize: 13, color: '#2563eb', fontWeight: '600' },
  versionItem: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#bfdbfe' },
  versionItemVersion: { fontSize: 13, fontWeight: '600', color: '#1e3a8a' },
  versionItemChanges: { fontSize: 13, color: '#334155', marginTop: 2 },
  lockedContent: { alignItems: 'center', paddingVertical: 28 },
  lockedIcon: { fontSize: 40, marginBottom: 8 },
  lockedText: { fontSize: 15, color: '#374151', marginBottom: 16 },
  lockedButton: { paddingHorizontal: 24 },
  actionButtons: { borderTopWidth: 1, borderTopColor: '#e5e7eb', backgroundColor: '#fff', padding: 12 },
  buttonRow: { flexDirection: 'row', gap: 10, maxWidth: 820, width: '100%', alignSelf: 'center' },
  flexButton: { flex: 1, paddingVertical: 12 },
});
