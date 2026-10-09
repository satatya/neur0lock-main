import React, { useMemo, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { P } from '../../constants/permissions';
import { useAuth } from '../../context/AuthContext';
import { useStepUp } from '../../context/StepUpContext';
import { NoteMeta, therapyNoteAPI } from '../../services/api';
import { formatDate, relativeTime } from '../common/format';
import { useAsync } from '../common/hooks';
import { ActionButton, EmptyState, ErrorView, LoadingView, SectionHeader } from '../common/layout';
import { Alert, Badge, Card, CardContent } from '../ui';
import { ModuleProps } from './PatientsModule';
import { moduleStyles as s } from './styles';

/** Opens a note after re-authentication (therapy notes are always protected by step-up). */
export function useOpenNote(navigation: any) {
    const { ensureStepUp } = useStepUp();
    return async (note: Pick<NoteMeta, 'id' | 'patient_id'>) => {
        const ok = await ensureStepUp('Therapy notes are encrypted. Re-enter your password to decrypt this note.');
        if (ok) navigation.navigate('SecureNoteEditorNew', { noteId: note.id, patientId: note.patient_id });
    };
}

export function NoteList({ notes, onOpen }: { notes: NoteMeta[]; onOpen: (note: NoteMeta) => void }) {
    if (notes.length === 0) return <EmptyState icon="📄" message="No therapy notes yet" />;
    return (
        <View style={s.list}>
            {notes.map((note) => (
                <TouchableOpacity key={note.id} onPress={() => onOpen(note)} activeOpacity={0.75}>
                    <Card>
                        <CardContent style={s.itemContent}>
                            <View style={s.rowBetween}>
                                <View style={{ flex: 1 }}>
                                    <Text style={s.title}>{note.note_type}</Text>
                                    <Text style={s.subtitle}>
                                        {note.patient_name} · {note.patient_mrn}
                                    </Text>
                                </View>
                                <View style={s.badges}>
                                    <Badge variant="outline">🔒 Encrypted</Badge>
                                    {note.version > 1 ? <Badge variant="secondary">v{note.version}</Badge> : null}
                                </View>
                            </View>
                            <Text style={s.meta}>
                                Session {formatDate(note.session_date)} · by {note.author_name} · updated {relativeTime(note.updated_at)}
                            </Text>
                            <Text style={[s.meta, { color: '#2563eb' }]}>Tap to decrypt (requires re-authentication)</Text>
                        </CardContent>
                    </Card>
                </TouchableOpacity>
            ))}
        </View>
    );
}

export function NotesModule({ navigation, refreshKey }: ModuleProps) {
    const { can } = useAuth();
    const openNote = useOpenNote(navigation);
    const [search, setSearch] = useState('');
    const [mine, setMine] = useState(false);
    const { user } = useAuth();
    const { data, loading, error, reload } = useAsync(async () => (await therapyNoteAPI.getAll()).data, [refreshKey]);

    const notes = useMemo(
        () =>
            (data ?? []).filter((note) => {
                if (mine && note.author_id !== user?.id) return false;
                if (!search) return true;
                const term = search.toLowerCase();
                return note.patient_name.toLowerCase().includes(term) || note.patient_mrn.toLowerCase().includes(term) || note.note_type.toLowerCase().includes(term);
            }),
        [data, search, mine, user?.id],
    );

    return (
        <View>
            <SectionHeader
                title="Therapy Notes"
                subtitle="Encrypted at rest (AES-256-GCM, per-note keys). Content is only decrypted after re-authentication."
                action={can(P.NOTES_CREATE) ? <ActionButton label="📄 New Note" small onPress={() => navigation.navigate('SecureNoteEditorNew', {})} /> : null}
            />
            <Alert
                variant="default"
                title="Access is audited"
                description="Every note you open is recorded in the audit log with your name, time and device."
                style={s.notice}
            />
            <TextInput style={s.search} value={search} onChangeText={setSearch} placeholder="🔍  Search patient, MRN or note type…" placeholderTextColor="#94a3b8" />
            <TouchableOpacity onPress={() => setMine(!mine)} style={{ marginBottom: 12 }}>
                <Text style={{ color: '#2563eb', fontWeight: '600' }}>{mine ? '☑' : '☐'} Only notes I wrote</Text>
            </TouchableOpacity>
            {loading && !data ? <LoadingView /> : null}
            {error ? <ErrorView message={error.message} onRetry={reload} /> : null}
            {data ? <NoteList notes={notes} onOpen={openNote} /> : null}
        </View>
    );
}
