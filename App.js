import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

// Screens
import SettingsScreen from './screens/SettingsScreen';        // Single file
import PasswordsScreen from './screens/PasswordsScreen';        // Folder with index.jsx
import TasksScreen from './screens/TasksScreen';                // Folder with index.jsx
import { ServerProvider } from './context/ServerContext';

const Tab = createBottomTabNavigator();

export default function App() {
  return (
    <ServerProvider>
      <NavigationContainer>
        <StatusBar style="auto" />
        <Tab.Navigator
          screenOptions={({ route }) => ({
            tabBarIcon: ({ focused, color, size }) => {
              let iconName;
              if (route.name === 'Passwords') iconName = 'key-variant';
              else if (route.name === 'Tasks') iconName = 'checkbox-marked-circle-outline';
              else if (route.name === 'Settings') iconName = 'cog-outline';
              return <Icon name={iconName} size={size} color={color} />;
            },
            tabBarActiveTintColor: '#4CAF50',
            tabBarInactiveTintColor: 'gray',
            headerStyle: { backgroundColor: '#4CAF50' },
            headerTintColor: '#fff',
          })}
        >
          <Tab.Screen name="Passwords" component={PasswordsScreen} />
          <Tab.Screen name="Tasks" component={TasksScreen} />
          <Tab.Screen name="Settings" component={SettingsScreen} />
        </Tab.Navigator>
      </NavigationContainer>
    </ServerProvider>
  );
}