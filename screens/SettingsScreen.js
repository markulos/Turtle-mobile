import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Platform,
  Keyboard,
  TouchableWithoutFeedback,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useServer } from '../context/ServerContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

export default function SettingsScreen() {
  const { serverIP, isConnected, loading, saveIP, checkConnection } = useServer();
  const [ipInput, setIpInput] = useState(serverIP);

  const handleSave = async () => {
    Keyboard.dismiss();
    if (!ipInput.trim()) {
      Alert.alert('Error', 'Please enter an IP address');
      return;
    }
    
    const success = await saveIP(ipInput.trim());
    Alert.alert(
      success ? 'Success' : 'Error',
      success ? 'Connected to server!' : 'Could not connect to server. Check IP and make sure server is running.'
    );
  };

  const handleTest = async () => {
    Keyboard.dismiss();
    const success = await checkConnection(serverIP);
    Alert.alert(
      success ? 'Connected' : 'Failed',
      success ? 'Server is reachable!' : 'Cannot reach server'
    );
  };

  return (
    <View style={styles.container}>
      <KeyboardAwareScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        enableOnAndroid={true}
        extraScrollHeight={Platform.OS === 'ios' ? 20 : 80}
        enableResetScrollToCoords={false}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.inner}>
            <Icon name="server-network" size={80} color="#4CAF50" style={styles.icon} />
            
            <Text style={styles.title}>Server Connection</Text>
            
            <View style={styles.statusContainer}>
              <View style={[styles.statusDot, isConnected ? styles.connected : styles.disconnected]} />
              <Text style={styles.statusText}>
                {loading ? 'Checking...' : (isConnected ? 'Connected' : 'Disconnected')}
              </Text>
            </View>

            <Text style={styles.label}>Computer IP Address:</Text>
            <TextInput
              style={styles.input}
              placeholder="192.168.1.100"
              value={ipInput}
              onChangeText={setIpInput}
              keyboardType="decimal-pad"
              autoCapitalize="none"
              returnKeyType="done"
              onSubmitEditing={Keyboard.dismiss}
            />
            
            <Text style={styles.hint}>
              Example: 192.168.1.5{'\n'}
              Make sure your phone and computer are on the same WiFi network
            </Text>

            <TouchableOpacity style={styles.button} onPress={handleSave}>
              <Text style={styles.buttonText}>Save & Connect</Text>
            </TouchableOpacity>

            {serverIP && (
              <TouchableOpacity 
                style={[styles.button, styles.testButton]} 
                onPress={handleTest}
              >
                <Text style={styles.buttonText}>Test Connection</Text>
              </TouchableOpacity>
            )}

            <View style={styles.infoBox}>
              <Text style={styles.infoTitle}>Setup Instructions:</Text>
              <Text style={styles.infoText}>
                1. Run the server on your computer{'\n'}
                2. Find your computer's IP address{'\n'}
                3. Enter it above and connect{'\n'}
                4. Data syncs automatically between devices
              </Text>
            </View>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollContent: {
    flexGrow: 1,
  },
  inner: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
  },
  icon: {
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
    color: '#333',
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 30,
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  connected: {
    backgroundColor: '#4CAF50',
  },
  disconnected: {
    backgroundColor: '#f44336',
  },
  statusText: {
    fontSize: 16,
    color: '#666',
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    color: '#333',
  },
  input: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#ddd',
    marginBottom: 10,
  },
  hint: {
    fontSize: 12,
    color: '#666',
    marginBottom: 20,
    lineHeight: 18,
  },
  button: {
    backgroundColor: '#4CAF50',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  testButton: {
    backgroundColor: '#2196F3',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  infoBox: {
    backgroundColor: '#e3f2fd',
    padding: 15,
    borderRadius: 10,
    marginTop: 20,
  },
  infoTitle: {
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#1976d2',
  },
  infoText: {
    color: '#555',
    lineHeight: 20,
    fontSize: 14,
  },
});