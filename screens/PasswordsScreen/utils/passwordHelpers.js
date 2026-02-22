export const filterPasswords = (passwords, searchQuery, isRegex) => {
  if (!searchQuery.trim()) return passwords;

  try {
    let regex;
    if (isRegex) {
      regex = new RegExp(searchQuery, 'i');
    } else {
      const escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      regex = new RegExp(escaped, 'i');
    }

    return passwords.filter(item => 
      regex.test(item.title) ||
      regex.test(item.username || '') ||
      regex.test(item.notes || '')
    );
  } catch (e) {
    const lowerQuery = searchQuery.toLowerCase();
    return passwords.filter(item =>
      item.title.toLowerCase().includes(lowerQuery) ||
      (item.username || '').toLowerCase().includes(lowerQuery) ||
      (item.notes || '').toLowerCase().includes(lowerQuery)
    );
  }
};

export const createPassword = (formData) => ({
  ...formData,
  id: Date.now().toString(),
});

export const updatePassword = (passwords, id, formData) => 
  passwords.map(p => p.id === id ? { ...formData, id } : p);