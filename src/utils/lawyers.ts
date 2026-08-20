// Utility functions to load and query lawyer data from JSON files
import fs from 'node:fs';
import path from 'node:path';

export interface LawyerData {
    name: string;
    category: string;
    verified: boolean;
    phone: string;
    website: string;
    email?: string | null;
    address: string;
    city: string;
    city_slug: string;
    state: string;
    state_slug: string;
    zipcode: string;
    latitude: number;
    longitude: number;
    logo: string;
    photos: string[];
    photo_count: number;
    rating: number;
    reviews_count: number;
    reviews_breakdown: {
        '1': number;
        '2': number;
        '3': number;
        '4': number;
        '5': number;
    };
    hours: Record<string, string>;
    description: string | null;
    place_id: string;
    found_by_query: string;
    scraped_at: string;
    // Computed field
    slug: string;
}

export interface CityData {
    city: string;
    city_slug: string;
    state: string;
    state_slug: string;
    total_lawyers: number;
    scraped_at: string;
    lawyers: Omit<LawyerData, 'slug'>[];
}

// Generate a URL-friendly slug from lawyer name
function createLawyerSlug(lawyerName: string, existingSlugsInCity: Set<string>): string {
    // Step 1: Clean the name
    let slug = lawyerName
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')  // Remove special chars (including &)
        .replace(/\s+/g, '-')          // Spaces → hyphens
        .replace(/-+/g, '-')           // Multiple hyphens → single
        .replace(/^-|-$/g, '');        // Trim hyphens

    // Step 2: Handle duplicates in same city
    let finalSlug = slug;
    let counter = 2;

    while (existingSlugsInCity.has(finalSlug)) {
        finalSlug = `${slug}-${counter}`;
        counter++;
    }

    // Step 3: Track this slug
    existingSlugsInCity.add(finalSlug);

    return finalSlug;
}

// Load all lawyer data from JSON files
let cachedLawyers: LawyerData[] | null = null;

export function getAllLawyers(): LawyerData[] {
    if (cachedLawyers) return cachedLawyers;

    const jsonDir = path.join(process.cwd(), 'src/scraped-data/json');
    const files = fs.readdirSync(jsonDir).filter(f => f.endsWith('.json'));

    const allLawyers: LawyerData[] = [];

    // Track slugs per city to handle duplicates
    const slugsPerCity = new Map<string, Set<string>>();

    for (const file of files) {
        const filePath = path.join(jsonDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const cityData: CityData = JSON.parse(content);

        // Get or create slug set for this city
        const cityKey = `${cityData.state_slug}/${cityData.city_slug}`;
        if (!slugsPerCity.has(cityKey)) {
            slugsPerCity.set(cityKey, new Set());
        }
        const citySlugs = slugsPerCity.get(cityKey)!;

        for (const lawyer of cityData.lawyers) {
            allLawyers.push({
                ...lawyer,
                slug: createLawyerSlug(lawyer.name, citySlugs),
            });
        }
    }

    cachedLawyers = allLawyers;
    return allLawyers;
}

// Get unique states
export function getAllStates(): { state: string; state_slug: string }[] {
    const lawyers = getAllLawyers();
    const stateMap = new Map<string, { state: string; state_slug: string }>();

    for (const lawyer of lawyers) {
        if (!stateMap.has(lawyer.state_slug)) {
            stateMap.set(lawyer.state_slug, {
                state: lawyer.state,
                state_slug: lawyer.state_slug,
            });
        }
    }

    return Array.from(stateMap.values()).sort((a, b) => a.state.localeCompare(b.state));
}

// Get all unique cities
export function getAllCities(): { city: string; city_slug: string; state: string; state_slug: string }[] {
    const lawyers = getAllLawyers();
    const cityMap = new Map<string, { city: string; city_slug: string; state: string; state_slug: string }>();

    for (const lawyer of lawyers) {
        const key = `${lawyer.state_slug}/${lawyer.city_slug}`;
        if (!cityMap.has(key)) {
            cityMap.set(key, {
                city: lawyer.city,
                city_slug: lawyer.city_slug,
                state: lawyer.state,
                state_slug: lawyer.state_slug,
            });
        }
    }

    return Array.from(cityMap.values());
}

// Get cities for a state with stats
export function getCitiesForState(stateSlug: string): {
    city: string;
    city_slug: string;
    lawyerCount: number;
    avgRating: number;
}[] {
    const lawyers = getAllLawyers().filter(l => l.state_slug === stateSlug);
    const cityMap = new Map<string, {
        city: string;
        city_slug: string;
        lawyers: LawyerData[];
    }>();

    for (const lawyer of lawyers) {
        const existing = cityMap.get(lawyer.city_slug);
        if (existing) {
            existing.lawyers.push(lawyer);
        } else {
            cityMap.set(lawyer.city_slug, {
                city: lawyer.city,
                city_slug: lawyer.city_slug,
                lawyers: [lawyer],
            });
        }
    }

    return Array.from(cityMap.values())
        .map(c => ({
            city: c.city,
            city_slug: c.city_slug,
            lawyerCount: c.lawyers.length,
            avgRating: Math.round((c.lawyers.reduce((sum, l) => sum + l.rating, 0) / c.lawyers.length) * 10) / 10,
        }))
        .sort((a, b) => b.lawyerCount - a.lawyerCount);
}

// Get lawyers for a specific state
export function getLawyersByState(stateSlug: string): LawyerData[] {
    return getAllLawyers().filter(l => l.state_slug === stateSlug);
}

// Get lawyers for a specific city
export function getLawyersByCity(stateSlug: string, citySlug: string): LawyerData[] {
    return getAllLawyers().filter(l => l.state_slug === stateSlug && l.city_slug === citySlug);
}

// Get a specific lawyer by state, city, and slug
export function getLawyerBySlug(stateSlug: string, citySlug: string, lawyerSlug: string): LawyerData | undefined {
    return getAllLawyers().find(
        l => l.state_slug === stateSlug && l.city_slug === citySlug && l.slug === lawyerSlug
    );
}

// Get top N lawyers from each city in a state (sorted by rating then review count)
export function getTopLawyersPerCity(stateSlug: string, perCity: number = 2): LawyerData[] {
    const lawyers = getLawyersByState(stateSlug);
    const cityMap = new Map<string, LawyerData[]>();

    for (const lawyer of lawyers) {
        const existing = cityMap.get(lawyer.city_slug);
        if (existing) {
            existing.push(lawyer);
        } else {
            cityMap.set(lawyer.city_slug, [lawyer]);
        }
    }

    const topLawyers: LawyerData[] = [];

    for (const [, cityLawyers] of cityMap) {
        const sorted = cityLawyers
            .sort((a, b) => {
                if (b.rating !== a.rating) return b.rating - a.rating;
                return b.reviews_count - a.reviews_count;
            })
            .slice(0, perCity);
        topLawyers.push(...sorted);
    }

    return topLawyers.sort((a, b) => {
        if (b.rating !== a.rating) return b.rating - a.rating;
        return b.reviews_count - a.reviews_count;
    });
}

// Get state statistics
export function getStateStats(stateSlug: string): {
    totalLawyers: number;
    avgRating: number;
    totalCities: number;
} {
    const lawyers = getLawyersByState(stateSlug);
    const cities = new Set(lawyers.map(l => l.city_slug));

    return {
        totalLawyers: lawyers.length,
        avgRating: lawyers.length > 0
            ? Math.round((lawyers.reduce((sum, l) => sum + l.rating, 0) / lawyers.length) * 10) / 10
            : 0,
        totalCities: cities.size,
    };
}

// Get city statistics
export function getCityStats(stateSlug: string, citySlug: string): {
    totalLawyers: number;
    avgRating: number;
    city: string;
    state: string;
} {
    const lawyers = getLawyersByCity(stateSlug, citySlug);
    const firstLawyer = lawyers[0];

    return {
        totalLawyers: lawyers.length,
        avgRating: lawyers.length > 0
            ? Math.round((lawyers.reduce((sum, l) => sum + l.rating, 0) / lawyers.length) * 10) / 10
            : 0,
        city: firstLawyer?.city || '',
        state: firstLawyer?.state || '',
    };
}

// Check if currently open based on hours
export function isCurrentlyOpen(hours: Record<string, string>): boolean {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const now = new Date();
    const dayName = days[now.getDay()];
    const hourStr = hours[dayName];

    if (!hourStr) return false;
    if (hourStr.toLowerCase().includes('open 24 hours')) return true;
    if (hourStr.toLowerCase().includes('closed')) return false;

    // Try to parse hours like "9:00 AM - 5:00 PM"
    const match = hourStr.match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)?\s*[-–]\s*(\d{1,2}):?(\d{2})?\s*(AM|PM)?/i);
    if (!match) return false;

    try {
        const parseTime = (h: string, m: string, period: string): number => {
            let hour = parseInt(h);
            const minute = parseInt(m || '0');
            if (period?.toUpperCase() === 'PM' && hour !== 12) hour += 12;
            if (period?.toUpperCase() === 'AM' && hour === 12) hour = 0;
            return hour * 60 + minute;
        };

        const openTime = parseTime(match[1], match[2], match[3]);
        const closeTime = parseTime(match[4], match[5], match[6]);
        const currentTime = now.getHours() * 60 + now.getMinutes();

        return currentTime >= openTime && currentTime < closeTime;
    } catch {
        return false;
    }
}

// Format state name from slug
export function formatStateName(slug: string): string {
    return slug
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

// Format city name from slug  
export function formatCityName(slug: string): string {
    return slug
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}
