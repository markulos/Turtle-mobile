import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

// Screens
import SettingsScreen from './screens/SettingsScreen';
import PasswordsScreen from './screens/PasswordsScreen';
import TasksScreen from './screens/TasksScreen';
import { ServerProvider } from './context/ServerContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';

const Tab = createBottomTabNavigator();

function TabNavigator() {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;
          if (route.name === 'Passwords') iconName = focused ? 'shield-key' : 'shield-key-outline';
          else if (route.name === 'Tasks') iconName = focused ? 'checkbox-marked-circle' : 'checkbox-marked-circle-outline';
          else if (route.name === 'Settings') iconName = focused ? 'cog' : 'cog-outline';
          return <Icon name={iconName} size={24} color={color} />;
        },
        tabBarActiveTintColor: theme.colors.textPrimary,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarShowLabel: true,
        tabBarLabelStyle: {
          fontSize: 11,
          marginBottom: 4,
        },
        tabBarStyle: {
          backgroundColor: theme.colors.background,
          borderTopWidth: 0.5,
          borderTopColor: theme.colors.border,
          height: 49 + insets.bottom, // Standard iOS tab bar 49pt + safe area
          paddingBottom: insets.bottom,
          paddingTop: 6,
        },
        headerShown: false, // Hide default header
      })}
    >
      <Tab.Screen 
        name="Passwords" 
        component={PasswordsScreen}
        options={{ title: 'Passwords' }}
      />
      <Tab.Screen 
        name="Tasks" 
        component={TasksScreen}
        options={{ title: 'Tasks' }}
      />
      <Tab.Screen 
        name="Settings" 
        component={SettingsScreen}
        options={{ title: 'Settings' }}
      />
    </Tab.Navigator>
  );
}

function AppContent() {
  const { isDark } = useTheme();

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <NavigationContainer>
        <TabNavigator />
      </NavigationContainer>
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ServerProvider>
          <AppContent />
        </ServerProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
