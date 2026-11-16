import { useCallback, useMemo, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { useResource } from '../../api/useResource';
import type { ResourceState } from '../../components';
import type { CourseOut } from '../../contracts/generated';

const STORAGE_KEY = 'fc-course';

function readSavedCourse(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveCourse(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Sin almacenamiento (modo privado): la elección vive solo en memoria.
  }
}

export interface CourseSelection {
  courses: CourseOut[];
  courseId: string | null;
  setCourseId: (id: string) => void;
  state: ResourceState<CourseOut[]>;
  reload: () => void;
}

// Curso activo de la app. Con un solo curso se elige solo; con varios, la
// elección se recuerda en `localStorage['fc-course']` (pantalla Temas, UI-13).
export function useCourse(): CourseSelection {
  const api = useApi();
  const state = useResource('courses', (signal) => api.courses({ signal }));
  const [chosen, setChosen] = useState<string | null>(null);
  const courses = state.status === 'ready' ? state.data : [];

  const courseId = useMemo(() => {
    if (courses.length === 0) return null;
    if (chosen !== null && courses.some((course) => course.id === chosen)) {
      return chosen;
    }
    const saved = readSavedCourse();
    if (saved !== null && courses.some((course) => course.id === saved)) {
      return saved;
    }
    return courses[0]?.id ?? null;
  }, [chosen, courses]);

  const setCourseId = useCallback((id: string) => {
    setChosen(id);
    saveCourse(id);
  }, []);

  return {
    courses,
    courseId,
    setCourseId,
    state,
    reload: state.reload,
  };
}
