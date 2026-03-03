import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { View, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

// Screens
import SettingsScreen from './screens/SettingsScreen';
import TasksScreen from './screens/TasksScreen';
import TurtleScreen from './screens/TurtleScreen';
import LoginScreen from './screens/LoginScreen';
import PhotosScreen from './screens/PhotosScreen';
import { ServerProvider } from './context/ServerContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { VaultProvider } from './context/VaultContext';
import { AuthProvider, useAuth } from './context/AuthContext';

const Tab = createBottomTabNavigator();

function TabNavigator() {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;
          if (route.name === 'Tasks') iconName = focused ? 'checkbox-marked-circle' : 'checkbox-marked-circle-outline';
          else if (route.name === 'Turtle') iconName = 'turtle';
          else if (route.name === 'Photos') iconName = focused ? 'image' : 'image-outline';
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
        name="Tasks" 
        component={TasksScreen}
        options={{ title: 'TO-DO' }}
      />
      <Tab.Screen 
        name="Turtle" 
        component={TurtleScreen}
        options={{ title: 'Turtle' }}
      />
      <Tab.Screen 
        name="Photos" 
        component={PhotosScreen}
        options={{ title: 'Photos' }}
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
  const { isDark, theme } = useTheme();
  const { isAuthenticated, isLoading } = useAuth();

  // Show loading spinner while checking for saved token
  if (isLoading) {
    return (
      <View style={{ 
        flex: 1, 
        justifyContent: 'center', 
        alignItems: 'center',
        backgroundColor: theme.colors.background 
      }}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  // Show login screen if not authenticated
  if (!isAuthenticated) {
    return (
      <>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <LoginScreen />
      </>
    );
  }

  // Show main app if authenticated
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
          <AuthProvider>
            <VaultProvider>
              <AppContent />
            </VaultProvider>
          </AuthProvider>
        </ServerProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
