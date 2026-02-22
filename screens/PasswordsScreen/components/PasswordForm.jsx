import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';

const INITIAL_FORM = { title: '', username: '', password: '', notes: '' };

export const PasswordForm = ({ visible, onClose, onSave, initialData }) => {
  const [formData, setFormData] = useState(INITIAL_FORM);
  const isEditing = !!initialData?.id;

  useEffect(() => {
    if (visible) {
      setFormData(initialData || INITIAL_FORM);
    }
  }, [visible, initialData]);

  const handleSave = () => {
    if (onSave(formData, initialData?.id)) {
      onClose();
    }
  };

  const updateField = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.content}>
          <Text style={styles.title}>
            {isEditing ? 'Edit Password' : 'Add Password'}
          </Text>
          
          <TextInput
            style={styles.input}
            placeholder="Title (e.g., Gmail, Netflix)"
            value={formData.title}
            onChangeText={text => updateField('title', text)}
          />
          
          <TextInput
            style={styles.input}
            placeholder="Username / Email"
            value={formData.username}
            onChangeText={text => updateField('username', text)}
            autoCapitalize="none"
          />
          
          <TextInput
            style={styles.input}
            placeholder="Password"
            value={formData.password}
            onChangeText={text => updateField('password', text)}
            secureTextEntry
          />
          
          <TextInput
            style={[styles.input, styles.notesInput]}
            placeholder="Notes (optional)"
            value={formData.notes}
            onChangeText={text => updateField('notes', text)}
            multiline
            numberOfLines={3}
          />
          
          <View style={styles.buttons}>
            <TouchableOpacity style={[styles.btn, styles.cancelBtn]} onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.saveBtn]} onPress={handleSave}>
              <Text style={styles.saveText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  content: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    minHeight: 400,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
    color: '#333',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 12,
    marginBottom: 15,
    fontSize: 16,
  },
  notesInput: {
    height: 80,
    textAlignVertical: 'top',
  },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  btn: {
    flex: 1,
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginHorizontal: 5,
  },
  cancelBtn: {
    backgroundColor: '#f5f5f5',
  },
  saveBtn: {
    backgroundColor: '#4CAF50',
  },
  cancelText: {
    color: '#666',
    fontWeight: '600',
  },
  saveText: {
    color: '#fff',
    fontWeight: '600',
  },
});