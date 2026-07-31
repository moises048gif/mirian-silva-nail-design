import {useEffect, useMemo, useState} from "react";
import {supabase} from "./lib/supabase";
import "./App.css";

type Service = {
    name: string;
    description: string;
    duration: string;
    durationMinutes: number;
    price: string;
};

type Appointment = {
    id: string;
    clientName: string;
    clientPhone: string;
    clientEmail: string;
    serviceName: string;
    date: string;
    startTime: string;
    durationMinutes: number;
    status: "pending" | "confirmed" | "completed" | "cancelled" | "no-show";
};

type ScheduleBlock = {
    id: string;
    date: string;
    startTime: string;
    endTime: string;
    reason?: string;
};

type TimeInterval = {
    start: number;
    end: number;
};

const fallbackServices: Service[] = [
    {
        name: "Esmaltação em Gel Básica",
        description:
            "Acabamento elegante, duradouro e com brilho intenso para suas unhas.",
        duration: "1h30",
        durationMinutes: 90,
        price: "R$ 60,00",
    },
    {
        name: "Esmaltação em Gel Decorada",
        description:
            "Esmaltação em gel com decoração personalizada e acabamento exclusivo.",
        duration: "2h",
        durationMinutes: 120,
        price: "R$ 70,00",
    },
    {
        name: "Reparo de Unha",
        description:
            "Reparo rápido e cuidadoso para recuperar uma unha danificada.",
        duration: "20 min",
        durationMinutes: 20,
        price: "R$ 10,00",
    },
];

function formatDateForInput(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

function timeToMinutes(time: string) {
    const [hours, minutes] = time.split(":").map(Number);
    return hours * 60 + minutes;
}

function minutesToTime(totalMinutes: number) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function mergeIntervals(intervals: TimeInterval[]) {
    const sorted = [...intervals].sort((a, b) => a.start - b.start);

    return sorted.reduce<TimeInterval[]>((merged, current) => {
        const previous = merged[merged.length - 1];

        if (!previous || current.start > previous.end) {
            merged.push({...current});
            return merged;
        }

        previous.end = Math.max(previous.end, current.end);
        return merged;
    }, []);
}

function intervalsOverlap(
    firstStart: number,
    firstEnd: number,
    secondStart: number,
    secondEnd: number,
) {
    return firstStart < secondEnd && firstEnd > secondStart;
}

function formatBrazilianPhone(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 11);

    if (digits.length <= 2) {
        return digits.length ? `(${digits}` : "";
    }

    if (digits.length <= 6) {
        return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    }

    if (digits.length <= 10) {
        return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    }

    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function formatCurrency(priceCents: number) {
    return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
    }).format(priceCents / 100);
}

function formatDuration(minutes: number) {
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes ? `${hours}h${String(remainingMinutes).padStart(2, "0")}` : `${hours}h`;
}

function PublicSite() {
    const [bookingStep, setBookingStep] = useState(1);
    const [clientName, setClientName] = useState("");
    const [clientPhone, setClientPhone] = useState("");
    const [clientEmail, setClientEmail] = useState("");
    const [selectedService, setSelectedService] = useState("");
    const [selectedDate, setSelectedDate] = useState("");
    const [selectedTime, setSelectedTime] = useState("");
    const [bookingError, setBookingError] = useState("");
    const [appointments, setAppointments] = useState<Appointment[]>([]);
    const [scheduleBlocks, setScheduleBlocks] = useState<ScheduleBlock[]>([]);
    const [isLoadingAppointments, setIsLoadingAppointments] = useState(true);
    const [isConfirmingBooking, setIsConfirmingBooking] = useState(false);
    const [services, setServices] = useState<Service[]>(fallbackServices);
    const [businessHours, setBusinessHours] = useState<Record<number, { startTime: string; endTime: string }>>({
        0: {startTime: "07:00", endTime: "13:00"},
        1: {startTime: "07:00", endTime: "19:00"},
        2: {startTime: "07:00", endTime: "19:00"},
        3: {startTime: "07:00", endTime: "19:00"},
        4: {startTime: "07:00", endTime: "19:00"},
        5: {startTime: "07:00", endTime: "19:00"},
        6: {startTime: "07:00", endTime: "13:00"},
    });

    function continueToDateSelection() {
        const normalizedName = clientName.trim().replace(/\s+/g, " ");
        const phoneDigits = clientPhone.replace(/\D/g, "");

        setBookingError("");

        if (normalizedName.length < 3) {
            setBookingError("Informe seu nome completo para continuar.");
            return;
        }

        if (phoneDigits.length < 10 || phoneDigits.length > 11) {
            setBookingError(
                "Informe um telefone válido com DDD, usando 10 ou 11 números.",
            );
            return;
        }

        if (!selectedServiceInformation) {
            setBookingError("Escolha um serviço para continuar.");
            return;
        }

        setClientName(normalizedName);
        setBookingStep(2);
    }

    useEffect(() => {
        async function loadPublicSettings() {
            const [{data: serviceData, error: serviceError}, {data: hoursData, error: hoursError}] =
                await Promise.all([
                    supabase
                        .from("services")
                        .select("id, name, description, duration_minutes, price_cents, display_order")
                        .eq("is_active", true)
                        .order("display_order", {ascending: true}),
                    supabase
                        .from("business_hours")
                        .select("day_of_week, start_time, end_time")
                        .order("day_of_week", {ascending: true}),
                ]);

            if (!serviceError && serviceData?.length) {
                setServices(
                    serviceData.map((service) => ({
                        name: service.name,
                        description: service.description ?? "",
                        duration: formatDuration(service.duration_minutes),
                        durationMinutes: service.duration_minutes,
                        price: formatCurrency(service.price_cents),
                    })),
                );
            }

            if (!hoursError && hoursData?.length) {
                setBusinessHours(
                    Object.fromEntries(
                        hoursData.map((hours) => [
                            hours.day_of_week,
                            {
                                startTime: String(hours.start_time).slice(0, 5),
                                endTime: String(hours.end_time).slice(0, 5),
                            },
                        ]),
                    ),
                );
            }
        }

        void loadPublicSettings();
    }, []);

    useEffect(() => {
        async function loadAppointments() {
            setIsLoadingAppointments(true);

            const [
                {data: appointmentData, error: appointmentError},
                {data: blockData, error: blockError},
            ] = await Promise.all([
                supabase
                    .from("occupied_appointments")
                    .select(
                        "id, appointment_date, start_time, duration_minutes, status",
                    )
                    .neq("status", "cancelled"),
                supabase
                    .from("schedule_blocks")
                    .select("id, block_date, start_time, end_time, reason"),
            ]);

            if (appointmentError || blockError) {
                console.error(
                    "Erro ao carregar horários:",
                    appointmentError || blockError,
                );
                setBookingError(
                    "Não foi possível carregar os horários ocupados. Atualize a página e tente novamente.",
                );
                setIsLoadingAppointments(false);
                return;
            }

            const loadedAppointments: Appointment[] = (
                appointmentData ?? []
            ).map((appointment) => ({
                id: appointment.id,
                clientName: "",
                clientPhone: "",
                clientEmail: "",
                serviceName: "",
                date: appointment.appointment_date,
                startTime: String(appointment.start_time).slice(0, 5),
                durationMinutes: appointment.duration_minutes,
                status: appointment.status as Appointment["status"],
            }));

            const loadedBlocks: ScheduleBlock[] = (blockData ?? []).map(
                (block) => ({
                    id: block.id,
                    date: block.block_date,
                    startTime: String(block.start_time).slice(0, 5),
                    endTime: String(block.end_time).slice(0, 5),
                    reason: block.reason || "",
                }),
            );

            setAppointments(loadedAppointments);
            setScheduleBlocks(loadedBlocks);
            setIsLoadingAppointments(false);
        }

        void loadAppointments();

        const appointmentsChannel = supabase
            .channel("public-appointments-updates")
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "appointments",
                },
                () => {
                    void loadAppointments();
                },
            )
            .subscribe();

        const blocksChannel = supabase
            .channel("public-schedule-blocks-updates")
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "schedule_blocks",
                },
                () => {
                    void loadAppointments();
                },
            )
            .subscribe();

        return () => {
            void supabase.removeChannel(appointmentsChannel);
            void supabase.removeChannel(blocksChannel);
        };
    }, []);

    const todayDate = new Date();
    const today = formatDateForInput(todayDate);
    const maximumClientDate = formatDateForInput(addDays(todayDate, 30));

    const selectedServiceInformation = services.find(
        (service) => service.name === selectedService,
    );

    function isWeekend(date: string) {
        const day = new Date(`${date}T12:00:00`).getDay();
        return day === 0 || day === 6;
    }

    function getOccupiedIntervals(date: string) {
        const appointmentIntervals = appointments
            .filter(
                (appointment) =>
                    appointment.date === date &&
                    appointment.status !== "cancelled" &&
                    appointment.status !== "no-show",
            )
            .map((appointment) => {
                const start = timeToMinutes(appointment.startTime);
                return {start, end: start + appointment.durationMinutes};
            });

        const blockedIntervals = scheduleBlocks
            .filter((block) => block.date === date)
            .map((block) => ({
                start: timeToMinutes(block.startTime),
                end: timeToMinutes(block.endTime),
            }));

        return mergeIntervals([...appointmentIntervals, ...blockedIntervals]);
    }

    function isPastTime(date: string, startMinutes: number) {
        if (date !== today) return false;

        const now = new Date();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();
        return startMinutes <= currentMinutes;
    }

    function getAvailableTimes(date: string, serviceDurationMinutes: number) {
        if (!date) return [];

        const dayOfWeek = new Date(`${date}T12:00:00`).getDay();
        const configuredHours = businessHours[dayOfWeek];
        const openingTime = configuredHours
            ? timeToMinutes(configuredHours.startTime)
            : 7 * 60;

        // O horário final representa o último horário em que um atendimento pode começar.
        // Segunda a sexta: último início às 19:00.
        // Sábado e domingo: último início às 13:00.
        const lastStartingTime = isWeekend(date) ? 13 * 60 : 19 * 60;
        const defaultInterval = 30;
        const occupiedIntervals = getOccupiedIntervals(date);
        const generatedTimes: number[] = [];

        let cursor = openingTime;
        let safetyCounter = 0;

        while (cursor <= lastStartingTime && safetyCounter < 100) {
            safetyCounter += 1;

            const intervalAtCursor = occupiedIntervals.find(
                (interval) => interval.start <= cursor && interval.end > cursor,
            );

            if (intervalAtCursor) {
                cursor = intervalAtCursor.end;
                continue;
            }

            generatedTimes.push(cursor);
            cursor += defaultInterval;
        }

        return generatedTimes
            .filter((start) => {
                const end = start + serviceDurationMinutes;
                const hasConflict = occupiedIntervals.some((interval) =>
                    intervalsOverlap(start, end, interval.start, interval.end),
                );

                return !hasConflict && !isPastTime(date, start);
            })
            .map(minutesToTime);
    }

    const availableTimes = useMemo(() => {
        if (!selectedServiceInformation || !selectedDate) return [];

        return getAvailableTimes(
            selectedDate,
            selectedServiceInformation.durationMinutes,
        );
    }, [
        appointments,
        scheduleBlocks,
        selectedDate,
        selectedServiceInformation,
        businessHours,
    ]);

    function formatSelectedDate() {
        if (!selectedDate) return "";

        return new Date(`${selectedDate}T12:00:00`).toLocaleDateString("pt-BR", {
            weekday: "long",
            day: "2-digit",
            month: "long",
            year: "numeric",
        });
    }

    function selectService(serviceName: string) {
        setSelectedService(serviceName);
        setSelectedDate("");
        setSelectedTime("");
        setBookingError("");
    }

    function closeBooking() {
        setBookingStep(1);
        setClientName("");
        setClientPhone("");
        setClientEmail("");
        setSelectedService("");
        setSelectedDate("");
        setSelectedTime("");
        setBookingError("");
    }

    async function confirmBooking() {
        setBookingError("");

        if (!selectedServiceInformation || !selectedDate || !selectedTime) {
            setBookingError("Revise o serviço, a data e o horário selecionados.");
            return;
        }

        setIsConfirmingBooking(true);

        try {
            const [
                {data: latestAppointments, error: appointmentLoadError},
                {data: latestBlocks, error: blockLoadError},
            ] = await Promise.all([
                supabase
                    .from("occupied_appointments")
                    .select(
                        "id, appointment_date, start_time, duration_minutes, status",
                    )
                    .eq("appointment_date", selectedDate)
                    .neq("status", "cancelled"),
                supabase
                    .from("schedule_blocks")
                    .select("id, block_date, start_time, end_time, reason")
                    .eq("block_date", selectedDate),
            ]);

            if (appointmentLoadError || blockLoadError) {
                throw appointmentLoadError || blockLoadError;
            }

            const appointmentsForSelectedDate: Appointment[] = (
                latestAppointments ?? []
            ).map((appointment) => ({
                id: appointment.id,
                clientName: "",
                clientPhone: "",
                clientEmail: "",
                serviceName: "",
                date: appointment.appointment_date,
                startTime: String(appointment.start_time).slice(0, 5),
                durationMinutes: appointment.duration_minutes,
                status: appointment.status as Appointment["status"],
            }));

            const blocksForSelectedDate: ScheduleBlock[] = (
                latestBlocks ?? []
            ).map((block) => ({
                id: block.id,
                date: block.block_date,
                startTime: String(block.start_time).slice(0, 5),
                endTime: String(block.end_time).slice(0, 5),
                reason: block.reason || "",
            }));

            const selectedStart = timeToMinutes(selectedTime);
            const selectedEnd =
                selectedStart + selectedServiceInformation.durationMinutes;

            const hasAppointmentConflict =
                appointmentsForSelectedDate.some((appointment) => {
                    const appointmentStart = timeToMinutes(
                        appointment.startTime,
                    );
                    const appointmentEnd =
                        appointmentStart + appointment.durationMinutes;

                    return intervalsOverlap(
                        selectedStart,
                        selectedEnd,
                        appointmentStart,
                        appointmentEnd,
                    );
                });

            const hasBlockConflict = blocksForSelectedDate.some((block) =>
                intervalsOverlap(
                    selectedStart,
                    selectedEnd,
                    timeToMinutes(block.startTime),
                    timeToMinutes(block.endTime),
                ),
            );

            if (hasAppointmentConflict || hasBlockConflict) {
                setAppointments((currentAppointments) => [
                    ...currentAppointments.filter(
                        (appointment) => appointment.date !== selectedDate,
                    ),
                    ...appointmentsForSelectedDate,
                ]);
                setScheduleBlocks((currentBlocks) => [
                    ...currentBlocks.filter(
                        (block) => block.date !== selectedDate,
                    ),
                    ...blocksForSelectedDate,
                ]);
                setSelectedTime("");
                setBookingStep(3);
                setBookingError(
                    "Este horário acabou de ficar indisponível. Escolha outro horário.",
                );
                return;
            }

            const {error: insertError} = await supabase
                .from("appointments")
                .insert({
                    client_name: clientName.trim(),
                    client_phone: clientPhone.trim(),
                    client_email: clientEmail.trim() || null,
                    service_name: selectedServiceInformation.name,
                    appointment_date: selectedDate,
                    start_time: selectedTime,
                    duration_minutes:
                    selectedServiceInformation.durationMinutes,
                    status: "confirmed",
                });

            if (insertError) {
                throw insertError;
            }

            const newAppointment: Appointment = {
                id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                clientName: clientName.trim(),
                clientPhone: clientPhone.trim(),
                clientEmail: clientEmail.trim(),
                serviceName: selectedServiceInformation.name,
                date: selectedDate,
                startTime: selectedTime,
                durationMinutes: selectedServiceInformation.durationMinutes,
                status: "confirmed",
            };

            setAppointments((currentAppointments) => [
                ...currentAppointments,
                newAppointment,
            ]);
            setBookingStep(5);
        } catch (error) {
            console.error("Erro ao confirmar agendamento:", error);
            setBookingError(
                "Não foi possível salvar o agendamento online. Verifique sua conexão e tente novamente.",
            );
        } finally {
            setIsConfirmingBooking(false);
        }
    }

    return (
        <main className="home">
            <section className="hero" id="inicio">
                <div className="hero__overlay"/>

                <header className="navbar">
                    <a className="brand" href="#inicio">
                        <span className="brand__symbol">MS</span>
                        <span className="brand__text">
                            <strong>Mirian Silva</strong>
                            <small>Nail Design</small>
                        </span>
                    </a>

                    <nav className="navbar__links" aria-label="Navegação principal">
                        <a href="#inicio">Início</a>
                        <a href="#servicos">Serviços</a>
                        <a href="#agendamento">Agendamento</a>
                    </nav>

                    <a className="navbar__button" href="/admin">
                        Login ADM
                    </a>
                </header>

                <div className="hero__content">
                    <span className="hero__eyebrow">Beleza em cada detalhe</span>
                    <h1>Mirian Silva<span>Nail Design</span></h1>
                    <p>Cuidados exclusivos para unhas elegantes, saudáveis e cheias de personalidade.</p>

                    <div className="hero__actions">
                        <a className="button button--primary" href="#agendamento">Agendar horário</a>
                        <a className="button button--instagram" href="https://www.instagram.com/nails.mirian.silva/"
                           target="_blank" rel="noopener noreferrer">Instagram</a>
                        <a className="button button--whatsapp"
                           href="https://wa.me/5548998074518?text=Olá%2C%20Mirian!%20Gostaria%20de%20mais%20informações%20sobre%20os%20serviços."
                           target="_blank" rel="noopener noreferrer">WhatsApp</a>
                    </div>

                    <div className="hero__details">
                        <div><strong>Atendimento personalizado</strong><span>Experiência pensada para você</span></div>
                        <div><strong>Agendamento online</strong><span>Rápido, simples e seguro</span></div>
                    </div>
                </div>

                <div className="hero__decoration hero__decoration--one"/>
                <div className="hero__decoration hero__decoration--two"/>
            </section>

            <section className="services" id="servicos">
                <div className="services__header">
                    <span className="section-label">Serviços exclusivos</span>
                    <h2>Escolha o cuidado ideal para suas unhas</h2>
                    <p>Confira os serviços disponíveis, seus valores e o tempo necessário para cada atendimento.</p>
                </div>

                <div className="services__grid">
                    {services.map((service, index) => (
                        <article className="service-card" key={service.name}>
                            <span className="service-card__number">{String(index + 1).padStart(2, "0")}</span>
                            <div className="service-card__content"><h3>{service.name}</h3><p>{service.description}</p>
                            </div>
                            <div className="service-card__footer">
                                <div><span>Duração</span><strong>{service.duration}</strong></div>
                                <div><span>Valor</span><strong>{service.price}</strong></div>
                            </div>
                            <a href="#agendamento" className="service-card__button"
                               onClick={() => selectService(service.name)}>Escolher este serviço</a>
                        </article>
                    ))}
                </div>
            </section>

            <section className="booking" id="agendamento">
                <div className="booking__information">
                    <span className="section-label">Agendamento online</span>
                    <h2>Reserve seu horário de forma rápida e fácil</h2>
                    <p>Informe seus dados e escolha o serviço desejado. Depois, você poderá selecionar a data e o
                        horário do atendimento.</p>

                    <div className="booking__steps">
                        <div className="booking__step"><span>01</span>
                            <div><strong>Preencha seus dados</strong><p>Informe seu nome e telefone para contato.</p>
                            </div>
                        </div>
                        <div className="booking__step"><span>02</span>
                            <div><strong>Escolha a data</strong><p>Selecione um dia dentro dos próximos 30 dias.</p>
                            </div>
                        </div>
                        <div className="booking__step"><span>03</span>
                            <div><strong>Escolha o horário</strong><p>Selecione uma das opções disponíveis.</p></div>
                        </div>
                    </div>

                    <div className="booking__notice"><span>✦</span><p>O tempo necessário será reservado automaticamente
                        de acordo com o serviço escolhido.</p></div>
                </div>

                <div className="booking__form-container">
                    <div className="booking__form-header"><span>Solicitação de agendamento</span><h3>Vamos começar?</h3>
                        <p>Preencha seus dados para escolher o dia e o horário.</p></div>

                    <form
                        className="booking__form"
                        onSubmit={(event) => {
                            event.preventDefault();
                            continueToDateSelection();
                        }}
                    >
                        <div className="form-group"><label htmlFor="client-name">Nome completo</label><input
                            id="client-name" name="client-name" type="text" placeholder="Digite seu nome"
                            autoComplete="name" minLength={3} maxLength={80} value={clientName} onChange={(event) => {
                            setClientName(event.target.value);
                            setBookingError("");
                        }} required/></div>
                        <div className="form-group"><label htmlFor="client-phone">Telefone ou WhatsApp</label><input
                            id="client-phone" name="client-phone" type="tel" inputMode="numeric"
                            placeholder="(00) 00000-0000" autoComplete="tel" maxLength={15} value={clientPhone}
                            onChange={(event) => {
                                setClientPhone(formatBrazilianPhone(event.target.value));
                                setBookingError("");
                            }} aria-describedby="client-phone-help" required/><small id="client-phone-help">Digite o DDD
                            e o número. A formatação é automática.</small></div>
                        <div className="form-group"><label htmlFor="client-email">E-mail — opcional</label><input
                            id="client-email" name="client-email" type="email" inputMode="email"
                            placeholder="seuemail@exemplo.com" autoComplete="email" maxLength={120} value={clientEmail}
                            onChange={(event) => {
                                setClientEmail(event.target.value);
                                setBookingError("");
                            }}/></div>
                        <div className="form-group"><label htmlFor="service">Escolha o serviço</label><select
                            id="service" name="service" value={selectedService}
                            onChange={(event) => selectService(event.target.value)} required>
                            <option value="" disabled>Selecione uma opção</option>
                            {services.map((service) => <option key={service.name}
                                                               value={service.name}>{service.name} — {service.price}</option>)}
                        </select></div>

                        {selectedServiceInformation && <div className="selected-service">
                            <span>Serviço selecionado</span><strong>{selectedServiceInformation.name}</strong>
                            <div>
                                <small>{selectedServiceInformation.duration}</small><small>{selectedServiceInformation.price}</small>
                            </div>
                        </div>}

                        {bookingStep === 1 && bookingError && (
                            <p className="booking-modal__error" role="alert" aria-live="polite">
                                {bookingError}
                            </p>
                        )}

                        <label className="form-checkbox"><input type="checkbox" required/><span>Confirmo que os dados informados estão corretos e desejo continuar para a escolha do dia e horário.</span></label>
                        <button className="booking__submit" type="submit">Continuar agendamento<span>→</span></button>
                        <p className="booking__security">Seus dados serão utilizados apenas para o agendamento.</p>
                    </form>
                </div>

                {bookingStep === 2 && <div className="booking-modal">
                    <div className="booking-modal__content">
                        <button className="booking-modal__close" type="button" onClick={() => setBookingStep(1)}
                                aria-label="Fechar escolha da data">×
                        </button>
                        <span className="section-label">Escolha a data</span><h3>Qual o melhor dia para você?</h3><p>As
                        clientes podem agendar dentro dos próximos 30 dias.</p>
                        <input className="booking-modal__date" type="date" min={today} max={maximumClientDate}
                               value={selectedDate} onChange={(event) => {
                            setSelectedDate(event.target.value);
                            setSelectedTime("");
                            setBookingError("");
                        }}/>
                        <div className="booking-modal__availability"><strong>Horários de atendimento</strong><span>Segunda a sexta: 07:00 até o último início às 19:00</span><span>Sábado e domingo: 07:00 até o último início às 13:00</span>
                        </div>
                        <button className="booking-modal__button" type="button"
                                disabled={!selectedDate || isLoadingAppointments}
                                onClick={() => setBookingStep(3)}>Continuar para horários
                        </button>
                    </div>
                </div>}

                {bookingStep === 3 && <div className="booking-modal">
                    <div className="booking-modal__content">
                        <button className="booking-modal__close" type="button" onClick={() => {
                            setBookingError("");
                            setBookingStep(2);
                        }} aria-label="Voltar para a escolha da data">←
                        </button>
                        <span className="section-label">Escolha o horário</span><h3>Qual horário fica melhor?</h3><p>Os
                        horários são calculados conforme os atendimentos já registrados e a duração do serviço.</p>
                        <div className="booking-modal__summary">
                            <div><span>Serviço</span><strong>{selectedService}</strong></div>
                            <div><span>Data escolhida</span><strong>{formatSelectedDate()}</strong></div>
                            <div><span>Duração</span><strong>{selectedServiceInformation?.duration}</strong></div>
                            <div>
                                <span>Tipo de agenda</span><strong>{isWeekend(selectedDate) ? "Fim de semana" : "Segunda a sexta"}</strong>
                            </div>
                        </div>
                        {bookingError && <p className="booking-modal__error">{bookingError}</p>}
                        {isLoadingAppointments ? (
                            <p>Carregando horários disponíveis...</p>
                        ) : availableTimes.length > 0 ? (
                            <div className="booking-times">
                                {availableTimes.map((time) => (
                                    <button
                                        key={time}
                                        className={
                                            selectedTime === time
                                                ? "booking-time booking-time--selected"
                                                : "booking-time"
                                        }
                                        type="button"
                                        onClick={() => {
                                            setSelectedTime(time);
                                            setBookingError("");
                                        }}
                                    >
                                        {time}
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="booking-times__empty">
                                <strong>Nenhum horário disponível nesta data.</strong>
                                <span>Volte e escolha outro dia para continuar.</span>
                            </div>
                        )}
                        <button className="booking-modal__button" type="button" disabled={!selectedTime}
                                onClick={() => {
                                    setBookingError("");
                                    setBookingStep(4);
                                }}>Revisar agendamento
                        </button>
                    </div>
                </div>}

                {bookingStep === 4 && <div className="booking-modal">
                    <div className="booking-modal__content">
                        <button className="booking-modal__close" type="button" onClick={() => {
                            setBookingError("");
                            setBookingStep(3);
                        }} aria-label="Voltar para os horários">←
                        </button>
                        <span className="section-label">Confirmação</span><h3>Revise seu agendamento</h3><p>Confira as
                        informações antes de confirmar a solicitação.</p>
                        <div className="booking-modal__summary">
                            <div><span>Cliente</span><strong>{clientName}</strong></div>
                            <div><span>Telefone</span><strong>{clientPhone}</strong></div>
                            <div><span>Serviço</span><strong>{selectedService}</strong></div>
                            <div><span>Data</span><strong>{formatSelectedDate()}</strong></div>
                            <div><span>Horário</span><strong>{selectedTime}</strong></div>
                            <div><span>Valor</span><strong>{selectedServiceInformation?.price ?? ""}</strong></div>
                        </div>
                        {bookingError && <p className="booking-modal__error">{bookingError}</p>}
                        <button className="booking-modal__button" type="button" disabled={isConfirmingBooking}
                                onClick={confirmBooking}>{isConfirmingBooking ? "Confirmando..." : "Confirmar agendamento"}</button>
                    </div>
                </div>}

                {bookingStep === 5 && <div className="booking-modal">
                    <div className="booking-modal__content booking-success">
                        <div className="booking-success__icon">✓</div>
                        <span className="section-label">Agendamento realizado</span><h3>Seu agendamento foi confirmado
                        com sucesso!</h3><p>Obrigado, {clientName}. Seu agendamento está confirmado e o horário já foi
                        reservado para você.</p>
                        <div className="booking-modal__summary">
                            <div><span>Serviço</span><strong>{selectedService}</strong></div>
                            <div><span>Data</span><strong>{formatSelectedDate()}</strong></div>
                            <div><span>Horário</span><strong>{selectedTime}</strong></div>
                            <div><span>Telefone</span><strong>{clientPhone}</strong></div>
                        </div>
                        <button className="booking-modal__button" type="button" onClick={closeBooking}>Finalizar
                        </button>
                    </div>
                </div>}
            </section>
        </main>
    );
}


type AdminAppointment = {
    id: string;
    client_name: string;
    client_phone: string;
    client_email: string | null;
    service_name: string;
    appointment_date: string;
    start_time: string;
    duration_minutes: number;
    status: "pending" | "confirmed" | "cancelled";
    created_at: string;
};

type AdminScheduleBlock = {
    id: string;
    block_date: string;
    start_time: string;
    end_time: string;
    reason: string | null;
    created_at: string;
};

type AdminServiceSetting = {
    id: number;
    name: string;
    description: string;
    duration_minutes: number;
    price_cents: number;
    display_order: number;
};

type AdminBusinessHour = {
    id: number;
    day_of_week: number;
    start_time: string;
    end_time: string;
};

type AdminClient = {
    key: string;
    name: string;
    phone: string;
    email: string;
    appointments: AdminAppointment[];
    lastAppointment: AdminAppointment | null;
    nextAppointment: AdminAppointment | null;
};

const dayNames = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

const adminStyles = `
.admin-page {
    min-height: 100vh;
    background:
        radial-gradient(circle at top left, rgba(216, 172, 184, 0.22), transparent 32rem),
        #f8f4f5;
    color: #251c1f;
    font-family: Arial, sans-serif;
}

.admin-login {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px;
}

.admin-login__card {
    width: min(100%, 430px);
    background: rgba(255, 255, 255, 0.96);
    border: 1px solid rgba(125, 78, 91, 0.14);
    border-radius: 24px;
    padding: 34px;
    box-shadow: 0 24px 70px rgba(83, 48, 58, 0.16);
}

.admin-login__brand {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 28px;
}

.admin-login__symbol {
    width: 54px;
    height: 54px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: linear-gradient(135deg, #b8788b, #6f3949);
    color: #fff;
    font-weight: 700;
}

.admin-login__brand strong,
.admin-login__brand span {
    display: block;
}

.admin-login__brand span {
    margin-top: 4px;
    color: #80666e;
    font-size: 0.88rem;
}

.admin-login h1 {
    margin: 0 0 8px;
    font-size: 1.75rem;
}

.admin-login > .admin-login__card > p {
    margin: 0 0 24px;
    color: #765f66;
    line-height: 1.5;
}

.admin-field {
    display: grid;
    gap: 8px;
    margin-bottom: 17px;
}

.admin-field label {
    font-weight: 700;
    font-size: 0.92rem;
}

.admin-field input,
.admin-toolbar input,
.admin-toolbar select {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #d8c7cc;
    border-radius: 12px;
    background: #fff;
    padding: 13px 14px;
    font: inherit;
    color: #251c1f;
}

.admin-field input:focus,
.admin-toolbar input:focus,
.admin-toolbar select:focus {
    outline: 2px solid rgba(184, 120, 139, 0.26);
    border-color: #a96679;
}

.admin-primary-button,
.admin-secondary-button,
.admin-action {
    border: 0;
    border-radius: 12px;
    font: inherit;
    font-weight: 700;
    cursor: pointer;
    transition: transform 0.16s ease, opacity 0.16s ease;
}

.admin-primary-button:hover,
.admin-secondary-button:hover,
.admin-action:hover {
    transform: translateY(-2px);
}

.admin-primary-button {
    width: 100%;
    padding: 14px 18px;
    background: linear-gradient(135deg, #a86175, #6d3445);
    color: white;
}

.admin-primary-button:disabled,
.admin-action:disabled {
    opacity: 0.6;
    cursor: wait;
}

.admin-login__error,
.admin-panel__error {
    border-radius: 12px;
    padding: 12px 14px;
    background: #fff0f1;
    color: #a02f3d;
    margin: 0 0 16px;
}

.admin-panel {
    width: min(1240px, calc(100% - 32px));
    margin: 0 auto;
    padding: 24px 0 64px;
}

.admin-header {
    position: sticky;
    top: 0;
    z-index: 50;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 20px;
    margin-bottom: 22px;
    padding: 16px 18px;
    border: 1px solid rgba(125, 78, 91, 0.12);
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.9);
    box-shadow: 0 10px 30px rgba(83, 48, 58, 0.08);
    backdrop-filter: blur(12px);
}

.admin-header h1 {
    margin: 0;
    font-size: clamp(1.55rem, 3vw, 2.35rem);
}

.admin-header p {
    margin: 6px 0 0;
    color: #765f66;
}

.admin-secondary-button {
    padding: 11px 16px;
    background: #fff;
    color: #6d3445;
    border: 1px solid #d7c0c7;
}

.admin-toolbar {
    display: grid;
    grid-template-columns: minmax(240px, 1fr) 210px 180px;
    gap: 12px;
    padding: 14px;
    margin-bottom: 16px;
    background: rgba(255, 255, 255, 0.94);
    border: 1px solid rgba(125, 78, 91, 0.12);
    border-radius: 16px;
    box-shadow: 0 8px 24px rgba(83, 48, 58, 0.05);
}

.admin-list {
    display: grid;
    gap: 14px;
}

.admin-appointment {
    background: white;
    border: 1px solid rgba(125, 78, 91, 0.13);
    border-radius: 20px;
    padding: 20px;
    box-shadow: 0 12px 35px rgba(83, 48, 58, 0.06);
}

.admin-appointment__top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 16px;
}

.admin-appointment__time {
    color: #9a5368;
    font-weight: 800;
    font-size: 1.15rem;
}

.admin-appointment h2 {
    margin: 5px 0 0;
    font-size: 1.18rem;
}

.admin-status {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 7px 11px;
    font-size: 0.78rem;
    font-weight: 800;
}

.admin-status--pending {
    background: #fff4d9;
    color: #8a6100;
}

.admin-status--confirmed {
    background: #e7f7ed;
    color: #1d7540;
}

.admin-status--cancelled {
    background: #f8e7ea;
    color: #9b3646;
}

.admin-appointment__details {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 14px;
    padding-top: 15px;
    border-top: 1px solid #eee4e7;
}

.admin-detail span {
    display: block;
    color: #80666e;
    font-size: 0.78rem;
    margin-bottom: 5px;
}

.admin-detail strong,
.admin-detail a {
    color: #312428;
    text-decoration: none;
    overflow-wrap: anywhere;
}

.admin-appointment__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 18px;
}

.admin-action {
    padding: 10px 13px;
}

.admin-action--confirm {
    background: #287c4a;
    color: white;
}

.admin-action--cancel {
    background: #a23f4d;
    color: white;
}

.admin-action--whatsapp {
    display: inline-flex;
    align-items: center;
    text-decoration: none;
    border-radius: 12px;
    padding: 10px 13px;
    background: #1f9d59;
    color: white;
    font-weight: 700;
}

.admin-empty,
.admin-loading {
    padding: 34px 20px;
    text-align: center;
    background: white;
    border-radius: 18px;
    color: #765f66;
}


.admin-date-navigation button,
.admin-view-switch button,
.admin-new-appointment__toggle,
.admin-block-form button,
.admin-manual-form__save,
.admin-manual-form__cancel {
    transition:
        transform 0.16s ease,
        box-shadow 0.16s ease,
        background-color 0.16s ease;
}

.admin-date-navigation button:hover,
.admin-view-switch button:hover,
.admin-new-appointment__toggle:hover,
.admin-block-form button:hover,
.admin-manual-form__save:hover,
.admin-manual-form__cancel:hover {
    transform: translateY(-1px);
}

.admin-new-appointment,
.admin-block-manager {
    border-radius: 20px;
    box-shadow: 0 12px 34px rgba(83, 48, 58, 0.07);
}


.admin-clients {
    padding: 22px;
    border: 1px solid rgba(125, 78, 91, 0.12);
    border-radius: 22px;
    background: rgba(255, 255, 255, 0.94);
    box-shadow: 0 14px 38px rgba(83, 48, 58, 0.07);
}

.admin-clients__header {
    display: flex;
    justify-content: space-between;
    gap: 24px;
    align-items: flex-start;
    margin-bottom: 20px;
}

.admin-clients__eyebrow {
    display: block;
    margin-bottom: 6px;
    color: #9a5368;
    font-size: 0.72rem;
    font-weight: 900;
    letter-spacing: 0.12em;
    text-transform: uppercase;
}

.admin-clients__header h2,
.admin-client-history h2,
.admin-client-editor h2 {
    margin: 0;
    color: #35272c;
}

.admin-clients__header p,
.admin-client-history > p {
    margin: 7px 0 0;
    color: #755961;
}

.admin-clients__count {
    min-width: 150px;
    padding: 13px 15px;
    border-radius: 16px;
    background: #f6e9ed;
    text-align: center;
}

.admin-clients__count strong,
.admin-clients__count span {
    display: block;
}

.admin-clients__count strong {
    color: #6d3445;
    font-size: 1.45rem;
}

.admin-clients__count span {
    margin-top: 3px;
    color: #755961;
    font-size: 0.75rem;
}

.admin-clients__search {
    margin-bottom: 20px;
}

.admin-clients__search label,
.admin-client-editor label {
    display: grid;
    gap: 7px;
    color: #5f454d;
    font-size: 0.82rem;
    font-weight: 800;
}

.admin-clients__search input,
.admin-client-editor input {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #dbc5cc;
    border-radius: 12px;
    padding: 11px 12px;
    background: #fff;
    color: #35272c;
    font: inherit;
}

.admin-clients__grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 15px;
}

.admin-client-card {
    padding: 17px;
    border: 1px solid rgba(125, 78, 91, 0.13);
    border-radius: 18px;
    background: #fff;
    box-shadow: 0 8px 24px rgba(83, 48, 58, 0.05);
}

.admin-client-card__top {
    display: flex;
    gap: 12px;
    align-items: center;
}

.admin-client-card__avatar {
    width: 46px;
    height: 46px;
    flex: 0 0 46px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: linear-gradient(135deg, #6d3445, #aa667a);
    color: #fff;
    font-weight: 900;
}

.admin-client-card__top h3 {
    margin: 0 0 4px;
    color: #35272c;
}

.admin-client-card__top a,
.admin-client-card__top span {
    display: block;
    color: #755961;
    font-size: 0.79rem;
    text-decoration: none;
}

.admin-client-card__metrics {
    display: grid;
    grid-template-columns: 0.8fr 1.2fr;
    gap: 10px;
    margin: 16px 0 12px;
}

.admin-client-card__metrics div,
.admin-client-card__next {
    padding: 11px;
    border-radius: 12px;
    background: #faf5f7;
}

.admin-client-card__metrics span,
.admin-client-card__next span {
    display: block;
    color: #8a7078;
    font-size: 0.7rem;
    font-weight: 800;
    text-transform: uppercase;
}

.admin-client-card__metrics strong,
.admin-client-card__next strong {
    display: block;
    margin-top: 4px;
    color: #4d363e;
    font-size: 0.84rem;
}

.admin-client-card__next {
    margin-bottom: 12px;
    background: #f3e4e9;
}

.admin-client-card__actions {
    display: flex;
    gap: 8px;
}

.admin-client-card__actions button {
    flex: 1;
    border: 0;
    border-radius: 10px;
    padding: 10px;
    background: #6d3445;
    color: #fff;
    font: inherit;
    font-size: 0.76rem;
    font-weight: 900;
    cursor: pointer;
}

.admin-client-card__actions button.is-secondary {
    background: #eadde1;
    color: #6d3445;
}

.admin-client-history,
.admin-client-editor {
    position: relative;
    width: min(100%, 650px);
    max-height: calc(100vh - 40px);
    overflow: auto;
    box-sizing: border-box;
    padding: 24px;
    border-radius: 22px;
    background: #fff;
    box-shadow: 0 22px 60px rgba(45, 25, 31, 0.22);
}

.admin-client-editor {
    width: min(100%, 470px);
    display: grid;
    gap: 15px;
}

.admin-client-history__list {
    display: grid;
    gap: 9px;
    margin-top: 20px;
}

.admin-client-history__list article {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 14px;
    padding: 13px;
    border: 1px solid rgba(125, 78, 91, 0.12);
    border-radius: 13px;
    background: #faf6f7;
}

.admin-client-history__list strong,
.admin-client-history__list span {
    display: block;
}

.admin-client-history__list div > span {
    margin-top: 3px;
    color: #755961;
    font-size: 0.78rem;
}

@media (max-width: 800px) {
    .admin-clients__grid {
        grid-template-columns: 1fr;
    }

    .admin-clients__header {
        flex-direction: column;
    }

    .admin-clients__count {
        width: 100%;
        box-sizing: border-box;
    }

    .admin-client-card__actions {
        flex-direction: column;
    }
}

@media (max-width: 800px) {
    .admin-summary {
        grid-template-columns: 1fr;
    }

    .admin-toolbar {
        grid-template-columns: 1fr;
    }

    .admin-appointment__details {
        grid-template-columns: 1fr 1fr;
    }
}


.admin-view-controls {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 14px;
    margin-bottom: 16px;
    padding: 12px 14px;
    border: 1px solid rgba(125, 78, 91, 0.12);
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.88);
}

.admin-view-switch {
    display: inline-flex;
    gap: 5px;
    padding: 5px;
    border-radius: 14px;
    background: #efe3e7;
    box-shadow: inset 0 0 0 1px rgba(109, 52, 69, 0.05);
}

.admin-view-switch button {
    border: 0;
    border-radius: 10px;
    padding: 10px 16px;
    background: transparent;
    color: #71545d;
    font: inherit;
    font-weight: 800;
    cursor: pointer;
}

.admin-view-switch button.is-active {
    background: #fff;
    color: #6d3445;
    box-shadow: 0 5px 16px rgba(83, 48, 58, 0.1);
}

.admin-date-navigation {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
}

.admin-date-navigation button {
    border: 1px solid #d7c0c7;
    border-radius: 11px;
    padding: 9px 12px;
    background: #fff;
    color: #6d3445;
    font: inherit;
    font-weight: 750;
    cursor: pointer;
}

.admin-selected-date {
    min-width: 225px;
    text-align: center;
    font-weight: 800;
    color: #4a343b;
    text-transform: capitalize;
}

.admin-agenda {
    display: grid;
    grid-template-columns: 76px minmax(0, 1fr);
    overflow: hidden;
    background: #fff;
    border: 1px solid rgba(125, 78, 91, 0.13);
    border-radius: 22px;
    box-shadow: 0 16px 42px rgba(83, 48, 58, 0.08);
}

.admin-agenda__hours {
    border-right: 1px solid #eadfe2;
    background: #fbf8f9;
}

.admin-agenda__hour-label {
    height: 76px;
    box-sizing: border-box;
    padding: 10px 12px 0 0;
    text-align: right;
    color: #8a7078;
    font-size: 0.8rem;
    border-bottom: 1px solid #f0e8ea;
}

.admin-agenda__canvas {
    position: relative;
    min-height: 1064px;
    background:
        repeating-linear-gradient(
            to bottom,
            transparent 0,
            transparent 75px,
            #f0e8ea 75px,
            #f0e8ea 76px
        );
}

.admin-agenda__appointment {
    transition:
        background-color 0.18s ease,
        border-color 0.18s ease,
        box-shadow 0.18s ease,
        transform 0.18s ease;
}

.admin-agenda__appointment {
    position: absolute;
    left: 12px;
    right: 12px;
    z-index: 2;
    overflow: auto;
    box-sizing: border-box;
    min-height: 48px;
    padding: 12px 14px;
    border: 1px solid #cfaab5;
    border-left: 5px solid #9a5368;
    border-radius: 14px;
    background: linear-gradient(135deg, #fff9fb, #f6e9ed);
    box-shadow: 0 8px 22px rgba(91, 50, 62, 0.11);
}

.admin-agenda__appointment.is-next {
    border-color: #d8aab6;
    border-left-color: #9f5065;
    background: #fff8fa;
    box-shadow: 0 8px 22px rgba(111, 48, 66, 0.14);
}

.admin-agenda__appointment.is-past {
    border-color: #ddd3d6;
    border-left-color: #aaa0a4;
    background: #f7f4f5;
    box-shadow: none;
    opacity: 0.68;
}

.admin-agenda__appointment.is-cancelled {
    border-color: #decbd0;
    border-left-color: #a9a0a3;
    background: #f4f1f2;
    opacity: 0.72;
}

.admin-agenda__appointment strong {
    display: block;
    color: #35272c;
    font-size: 1rem;
    line-height: 1.35;
}

.admin-agenda__appointment span {
    display: block;
    margin-top: 5px;
    color: #755961;
    font-size: 0.8rem;
    line-height: 1.35;
}

.admin-agenda__appointment span:first-of-type {
    font-weight: 700;
    color: #624850;
}

.admin-agenda__appointment span:nth-of-type(2) {
    color: #8a7078;
    font-size: 0.76rem;
}

.admin-agenda__appointment-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 7px;
    margin-top: 11px;
}

.admin-agenda__appointment-actions button,
.admin-agenda__appointment-actions a {
    min-height: 34px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 8px;
    padding: 7px 10px;
    font: inherit;
    font-size: 0.75rem;
    font-weight: 800;
    line-height: 1;
    cursor: pointer;
    text-decoration: none;
}

.admin-agenda__appointment-actions button:focus-visible,
.admin-agenda__appointment-actions a:focus-visible {
    outline: 3px solid rgba(154, 83, 104, 0.28);
    outline-offset: 2px;
}

.admin-agenda__appointment-actions button {
    background: #a23f4d;
    color: #fff;
}

.admin-agenda__appointment-actions a {
    background: #1f9d59;
    color: #fff;
}

.admin-agenda__empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 30px;
    color: #80666e;
    text-align: center;
}

.admin-next-appointment {
    position: relative;
    overflow: hidden;
    margin-bottom: 18px;
    padding: 20px 22px;
    border: 1px solid rgba(154, 83, 104, 0.2);
    border-radius: 20px;
    background: linear-gradient(135deg, #633042, #aa667a);
    color: #fff;
    box-shadow: 0 14px 38px rgba(83, 48, 58, 0.16);
}

.admin-next-appointment::after {
    content: "";
    position: absolute;
    width: 150px;
    height: 150px;
    right: -55px;
    top: -70px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.08);
}

.admin-next-appointment span {
    display: block;
    margin-bottom: 7px;
    font-size: 0.82rem;
    opacity: 0.84;
}

.admin-next-appointment strong {
    display: block;
    font-size: 1.08rem;
}

.admin-next-appointment small {
    display: block;
    margin-top: 5px;
    opacity: 0.9;
}


.admin-details-button {
    border: 0;
    border-radius: 8px;
    padding: 7px 9px;
    background: #6d3445;
    color: #fff;
    font: inherit;
    font-size: 0.75rem;
    font-weight: 800;
    cursor: pointer;
}

.admin-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: grid;
    place-items: center;
    padding: 18px;
    background: rgba(35, 21, 26, 0.62);
    backdrop-filter: blur(4px);
}

.admin-modal {
    width: min(100%, 620px);
    max-height: calc(100vh - 36px);
    overflow: auto;
    border-radius: 22px;
    background: #fff;
    box-shadow: 0 28px 80px rgba(35, 21, 26, 0.3);
}

.admin-modal__header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    padding: 22px 22px 16px;
    border-bottom: 1px solid #eee4e7;
}

.admin-modal__header h2 {
    margin: 0;
    font-size: 1.35rem;
}

.admin-modal__header p {
    margin: 6px 0 0;
    color: #80666e;
}

.admin-modal__close {
    width: 38px;
    height: 38px;
    flex: 0 0 auto;
    border: 0;
    border-radius: 50%;
    background: #f2e8eb;
    color: #6d3445;
    font-size: 1.2rem;
    cursor: pointer;
}

.admin-modal__body {
    padding: 20px 22px 24px;
}

.admin-modal__grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    margin-bottom: 22px;
}

.admin-modal__item {
    padding: 14px;
    border-radius: 14px;
    background: #faf6f7;
}

.admin-modal__item span {
    display: block;
    margin-bottom: 5px;
    color: #80666e;
    font-size: 0.78rem;
}

.admin-modal__item strong,
.admin-modal__item a {
    color: #312428;
    text-decoration: none;
    overflow-wrap: anywhere;
}

.admin-reschedule {
    padding-top: 20px;
    border-top: 1px solid #eee4e7;
}

.admin-reschedule h3 {
    margin: 0 0 6px;
}

.admin-reschedule > p {
    margin: 0 0 16px;
    color: #80666e;
    font-size: 0.9rem;
}

.admin-reschedule__fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
}

.admin-reschedule__fields label {
    display: grid;
    gap: 7px;
    font-weight: 750;
    font-size: 0.88rem;
}

.admin-reschedule__fields input,
.admin-reschedule__fields select {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #d8c7cc;
    border-radius: 11px;
    padding: 12px;
    background: #fff;
    color: #312428;
    font: inherit;
}

.admin-reschedule__message {
    margin: 13px 0 0;
    padding: 11px 12px;
    border-radius: 11px;
    background: #fff0f1;
    color: #a02f3d;
    font-size: 0.88rem;
}

.admin-reschedule__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 16px;
}

.admin-reschedule__save {
    border: 0;
    border-radius: 11px;
    padding: 11px 15px;
    background: #6d3445;
    color: #fff;
    font: inherit;
    font-weight: 800;
    cursor: pointer;
}

.admin-reschedule__save:disabled {
    opacity: 0.6;
    cursor: wait;
}

.admin-modal__whatsapp {
    display: inline-flex;
    margin-top: 16px;
    border-radius: 11px;
    padding: 11px 14px;
    background: #1f9d59;
    color: #fff;
    text-decoration: none;
    font-weight: 800;
}

@media (max-width: 560px) {
    .admin-modal__grid,
    .admin-reschedule__fields {
        grid-template-columns: 1fr;
    }

    .admin-modal__header,
    .admin-modal__body {
        padding-left: 17px;
        padding-right: 17px;
    }
}


.admin-block-manager {
    margin-bottom: 18px;
    padding: 18px;
    border: 1px solid rgba(125, 78, 91, 0.13);
    border-radius: 18px;
    background: #fff;
    box-shadow: 0 12px 35px rgba(83, 48, 58, 0.06);
}

.admin-block-manager__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 14px;
    margin-bottom: 14px;
}

.admin-block-manager__header h2 {
    margin: 0;
    font-size: 1.08rem;
}

.admin-block-manager__header p {
    margin: 5px 0 0;
    color: #80666e;
    font-size: 0.88rem;
}

.admin-block-form {
    display: grid;
    grid-template-columns: 1.2fr 1fr 1fr 1.6fr auto;
    gap: 10px;
    align-items: end;
}

.admin-block-form label {
    display: grid;
    gap: 7px;
    font-weight: 750;
    font-size: 0.84rem;
}

.admin-block-form input {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #d8c7cc;
    border-radius: 11px;
    padding: 11px 12px;
    font: inherit;
}

.admin-block-form button {
    border: 0;
    border-radius: 11px;
    padding: 11px 14px;
    background: #6d3445;
    color: #fff;
    font: inherit;
    font-weight: 800;
    cursor: pointer;
}

.admin-block-form button:disabled {
    opacity: 0.6;
    cursor: wait;
}

.admin-block-list {
    display: grid;
    gap: 9px;
    margin-top: 14px;
}

.admin-block-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 12px 13px;
    border-radius: 12px;
    background: #f8f1f3;
}

.admin-block-item strong,
.admin-block-item span {
    display: block;
}

.admin-block-item span {
    margin-top: 3px;
    color: #80666e;
    font-size: 0.82rem;
}

.admin-block-item button {
    border: 0;
    border-radius: 9px;
    padding: 8px 10px;
    background: #a23f4d;
    color: #fff;
    font: inherit;
    font-size: 0.8rem;
    font-weight: 800;
    cursor: pointer;
}

.admin-agenda__block {
    position: absolute;
    left: 12px;
    right: 12px;
    z-index: 1;
    box-sizing: border-box;
    min-height: 46px;
    padding: 10px 12px;
    border: 1px dashed #95858a;
    border-left: 5px solid #6b6265;
    border-radius: 12px;
    background:
        repeating-linear-gradient(
            -45deg,
            #ece8e9,
            #ece8e9 9px,
            #f5f2f3 9px,
            #f5f2f3 18px
        );
    color: #51484b;
    overflow: hidden;
}

.admin-agenda__block strong {
    display: block;
    font-size: 0.9rem;
}

.admin-agenda__block span {
    display: block;
    margin-top: 4px;
    font-size: 0.78rem;
}

.admin-block-error {
    margin: 12px 0 0;
    padding: 11px 12px;
    border-radius: 11px;
    background: #fff0f1;
    color: #a02f3d;
    font-size: 0.88rem;
}

@media (max-width: 950px) {
    .admin-block-form {
        grid-template-columns: 1fr 1fr;
    }

    .admin-block-form button {
        grid-column: 1 / -1;
    }
}

@media (max-width: 560px) {
    .admin-block-form {
        grid-template-columns: 1fr;
    }

    .admin-block-item {
        align-items: flex-start;
        flex-direction: column;
    }
}


.admin-new-appointment {
    margin-bottom: 18px;
    padding: 18px;
    border: 1px solid rgba(125, 78, 91, 0.13);
    border-radius: 18px;
    background: #fff;
    box-shadow: 0 12px 35px rgba(83, 48, 58, 0.06);
}

.admin-new-appointment__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 14px;
    margin-bottom: 14px;
}

.admin-new-appointment__header h2 {
    margin: 0;
    font-size: 1.08rem;
}

.admin-new-appointment__header p {
    margin: 5px 0 0;
    color: #80666e;
    font-size: 0.88rem;
}

.admin-new-appointment__toggle {
    border: 0;
    border-radius: 11px;
    padding: 10px 14px;
    background: #6d3445;
    color: #fff;
    font: inherit;
    font-weight: 800;
    cursor: pointer;
}

.admin-manual-form {
    display: grid;
    grid-template-columns: 1.2fr 1fr 1.3fr 1fr 1fr;
    gap: 11px;
    align-items: end;
}

.admin-manual-form label {
    display: grid;
    gap: 7px;
    font-weight: 750;
    font-size: 0.84rem;
}

.admin-manual-form input,
.admin-manual-form select {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #d8c7cc;
    border-radius: 11px;
    padding: 11px 12px;
    background: #fff;
    color: #312428;
    font: inherit;
}

.admin-manual-form__email {
    grid-column: span 2;
}

.admin-manual-form__actions {
    display: flex;
    gap: 10px;
    align-items: center;
}

.admin-manual-form__save {
    border: 0;
    border-radius: 11px;
    padding: 11px 15px;
    background: #6d3445;
    color: #fff;
    font: inherit;
    font-weight: 800;
    cursor: pointer;
}

.admin-manual-form__save:disabled {
    opacity: 0.6;
    cursor: wait;
}

.admin-manual-form__cancel {
    border: 1px solid #d8c7cc;
    border-radius: 11px;
    padding: 10px 14px;
    background: #fff;
    color: #6d3445;
    font: inherit;
    font-weight: 800;
    cursor: pointer;
}

.admin-manual-form__error,
.admin-manual-form__success {
    grid-column: 1 / -1;
    margin: 0;
    padding: 11px 12px;
    border-radius: 11px;
    font-size: 0.88rem;
}

.admin-manual-form__error {
    background: #fff0f1;
    color: #a02f3d;
}

.admin-manual-form__success {
    background: #eef9f2;
    color: #247145;
}

@media (max-width: 1050px) {
    .admin-manual-form {
        grid-template-columns: 1fr 1fr;
    }

    .admin-manual-form__email {
        grid-column: auto;
    }

    .admin-manual-form__actions {
        grid-column: 1 / -1;
    }
}

@media (max-width: 620px) {
    .admin-new-appointment__header {
        align-items: stretch;
        flex-direction: column;
    }

    .admin-manual-form {
        grid-template-columns: 1fr;
    }

    .admin-manual-form__actions {
        grid-column: auto;
        flex-direction: column;
        align-items: stretch;
    }
}


.admin-week {
    overflow-x: auto;
    padding-bottom: 8px;
}

.admin-week__grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(210px, 1fr));
    gap: 12px;
    min-width: 1510px;
}

.admin-week__day {
    min-height: 430px;
    border: 1px solid rgba(125, 78, 91, 0.14);
    border-radius: 18px;
    background: #fff;
    overflow: hidden;
    box-shadow: 0 10px 28px rgba(83, 48, 58, 0.05);
    transition: transform 0.18s ease, box-shadow 0.18s ease;
}

.admin-week__day:hover {
    transform: translateY(-2px);
    box-shadow: 0 14px 34px rgba(83, 48, 58, 0.08);
}

.admin-week__day.is-today {
    border-color: #6d3445;
    box-shadow: 0 0 0 2px rgba(109, 52, 69, 0.12);
}

.admin-week__day.is-today .admin-week__day-header {
    background: linear-gradient(135deg, #6d3445, #9a5368);
}

.admin-week__day.is-today .admin-week__day-header span,
.admin-week__day.is-today .admin-week__day-header strong {
    color: #fff;
}

.admin-week__day-header {
    padding: 14px;
    border-bottom: 1px solid #eee4e7;
    background: #faf6f7;
}

.admin-week__day-header span,
.admin-week__day-header strong {
    display: block;
}

.admin-week__day-header span {
    color: #80666e;
    font-size: 0.78rem;
    font-weight: 800;
    text-transform: uppercase;
}

.admin-week__day-header strong {
    margin-top: 4px;
    color: #312428;
    font-size: 1.05rem;
}

.admin-week__content {
    display: grid;
    gap: 9px;
    padding: 11px;
}

.admin-week__appointment,
.admin-week__block {
    padding: 11px;
    border-radius: 12px;
}

.admin-week__appointment {
    border-left: 4px solid #6d3445;
    background: #f8eef1;
}

.admin-week__appointment.is-cancelled {
    border-left-color: #a79a9e;
    background: #f2eff0;
    opacity: 0.72;
}

.admin-week__block {
    border-left: 4px solid #6b6265;
    background:
        repeating-linear-gradient(
            -45deg,
            #ece8e9,
            #ece8e9 8px,
            #f5f2f3 8px,
            #f5f2f3 16px
        );
}

.admin-week__appointment strong,
.admin-week__block strong {
    display: block;
    color: #312428;
    font-size: 0.88rem;
}

.admin-week__appointment span,
.admin-week__block span {
    display: block;
    margin-top: 4px;
    color: #6f5c62;
    font-size: 0.76rem;
    line-height: 1.35;
}

.admin-week__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 9px;
}

.admin-week__actions button,
.admin-week__actions a {
    border: 0;
    border-radius: 8px;
    padding: 7px 8px;
    font: inherit;
    font-size: 0.72rem;
    font-weight: 800;
    cursor: pointer;
    text-decoration: none;
}

.admin-week__actions button {
    background: #6d3445;
    color: #fff;
}

.admin-week__actions a {
    background: #1f9d59;
    color: #fff;
}

.admin-week__empty {
    padding: 22px 10px;
    color: #9a858c;
    text-align: center;
    font-size: 0.82rem;
}

@media (max-width: 720px) {
    .admin-view-controls,
    .admin-date-navigation {
        align-items: stretch;
    }

    .admin-view-controls {
        flex-direction: column;
    }

    .admin-view-switch {
        display: grid;
        grid-template-columns: 1fr 1fr;
    }

    .admin-date-navigation {
        display: grid;
        grid-template-columns: auto 1fr auto;
    }

    .admin-date-navigation .admin-today-button {
        grid-column: 1 / -1;
    }

    .admin-selected-date {
        min-width: 0;
        align-self: center;
    }

    .admin-agenda {
        grid-template-columns: 58px minmax(0, 1fr);
    }

    .admin-agenda__hour-label {
        padding-right: 7px;
    }

    .admin-agenda__appointment {
        left: 7px;
        right: 7px;
        padding: 9px;
    }
}

@media (max-width: 520px) {
    .admin-panel {
        width: min(100% - 20px, 1180px);
        padding-top: 16px;
    }

    .admin-header {
        align-items: flex-start;
    }

    .admin-login__card {
        padding: 25px 20px;
    }

    .admin-appointment__details {
        grid-template-columns: 1fr;
    }

    .admin-appointment__top {
        flex-direction: column;
    }
}
`;

function formatAdminDate(date: string) {
    return new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", {
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
    });
}

function normalizePhoneForWhatsApp(phone: string) {
    const digits = phone.replace(/\D/g, "");

    if (digits.startsWith("55")) {
        return digits;
    }

    return `55${digits}
.admin-settings { display: grid; gap: 24px; }
.admin-settings__intro { display:flex; justify-content:space-between; gap:20px; align-items:flex-start; background:#fff; border:1px solid #eadde1; border-radius:20px; padding:24px; }
.admin-settings__intro h2 { margin:4px 0 8px; }
.admin-settings__intro p { margin:0; color:#765f66; line-height:1.5; }
.admin-settings__eyebrow { color:#92566a; text-transform:uppercase; letter-spacing:.12em; font-size:.75rem; font-weight:800; }
.admin-settings__section { background:#fff; border:1px solid #eadde1; border-radius:20px; padding:24px; }
.admin-settings__section-header { margin-bottom:18px; }
.admin-settings__section-header h3 { margin:0 0 6px; }
.admin-settings__section-header p { margin:0; color:#765f66; }
.admin-settings__list { display:grid; gap:14px; }
.admin-settings__service { display:grid; grid-template-columns:minmax(220px,2fr) minmax(130px,1fr) minmax(130px,1fr) auto; gap:14px; align-items:end; padding:16px; background:#fbf8f9; border:1px solid #eee2e5; border-radius:16px; }
.admin-settings__hours { display:grid; grid-template-columns:minmax(150px,1.4fr) minmax(130px,1fr) minmax(130px,1fr) auto; gap:14px; align-items:end; padding:14px 16px; border-bottom:1px solid #eee2e5; }
.admin-settings__hours:last-child { border-bottom:0; }
.admin-settings label { display:grid; gap:7px; font-weight:700; font-size:.88rem; }
.admin-settings input { width:100%; box-sizing:border-box; border:1px solid #d8c7cc; border-radius:11px; padding:11px 12px; font:inherit; color:#251c1f; background:#fff; }
.admin-settings button { border:0; border-radius:11px; padding:12px 16px; background:#7d4b5a; color:#fff; font-weight:800; cursor:pointer; white-space:nowrap; }
.admin-settings button:disabled { opacity:.6; cursor:wait; }
.admin-settings__message { margin:0; padding:13px 15px; border-radius:12px; font-weight:700; }
.admin-settings__message--error { background:#fff0f0; color:#9d3030; }
.admin-settings__message--success { background:#eef8f1; color:#2e7545; }
@media (max-width: 850px) { .admin-settings__service, .admin-settings__hours { grid-template-columns:1fr 1fr; } .admin-settings__service label:first-child, .admin-settings__hours strong { grid-column:1/-1; } }
@media (max-width: 560px) { .admin-settings__service, .admin-settings__hours { grid-template-columns:1fr; } .admin-settings__service label:first-child, .admin-settings__hours strong { grid-column:auto; } .admin-settings button { width:100%; } }
`;
}


function addDaysToInputDate(date: string, amount: number) {
    const value = new Date(`${date}T12:00:00`);
    value.setDate(value.getDate() + amount);
    return formatDateForInput(value);
}

function getMinutesFromTime(time: string) {
    const [hours, minutes] = String(time).slice(0, 5).split(":").map(Number);
    return hours * 60 + minutes;
}

function getAppointmentDateTime(appointment: AdminAppointment) {
    return new Date(
        `${appointment.appointment_date}T${String(appointment.start_time).slice(0, 5)}:00`,
    );
}

function AdminPanel() {
    const [isCheckingSession, setIsCheckingSession] = useState(true);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loginError, setLoginError] = useState("");
    const [isLoggingIn, setIsLoggingIn] = useState(false);
    const [appointments, setAppointments] = useState<AdminAppointment[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [panelError, setPanelError] = useState("");
    const [search, setSearch] = useState("");
    const [dateFilter, setDateFilter] = useState("");
    const [statusFilter, setStatusFilter] = useState("confirmed");
    const [updatingId, setUpdatingId] = useState("");
    const [adminView, setAdminView] = useState<"agenda" | "week" | "list" | "clients" | "settings">("agenda");
    const [agendaDate, setAgendaDate] = useState(formatDateForInput(new Date()));
    const [selectedAdminAppointment, setSelectedAdminAppointment] =
        useState<AdminAppointment | null>(null);
    const [rescheduleDate, setRescheduleDate] = useState("");
    const [rescheduleTime, setRescheduleTime] = useState("");
    const [rescheduleError, setRescheduleError] = useState("");
    const [isRescheduling, setIsRescheduling] = useState(false);
    const [adminBlocks, setAdminBlocks] = useState<AdminScheduleBlock[]>([]);
    const [blockDate, setBlockDate] = useState(formatDateForInput(new Date()));
    const [blockStartTime, setBlockStartTime] = useState("12:00");
    const [blockEndTime, setBlockEndTime] = useState("13:00");
    const [blockReason, setBlockReason] = useState("");
    const [blockError, setBlockError] = useState("");
    const [isSavingBlock, setIsSavingBlock] = useState(false);
    const [showManualForm, setShowManualForm] = useState(false);
    const [manualClientName, setManualClientName] = useState("");
    const [manualClientPhone, setManualClientPhone] = useState("");
    const [manualClientEmail, setManualClientEmail] = useState("");
    const [manualServiceName, setManualServiceName] = useState(
        fallbackServices[0].name,
    );
    const [manualDate, setManualDate] = useState(
        formatDateForInput(new Date()),
    );
    const [manualTime, setManualTime] = useState("07:00");
    const [manualError, setManualError] = useState("");
    const [manualSuccess, setManualSuccess] = useState("");
    const [isSavingManualAppointment, setIsSavingManualAppointment] =
        useState(false);
    const [clientSearch, setClientSearch] = useState("");
    const [selectedClient, setSelectedClient] = useState<AdminClient | null>(null);
    const [editingClient, setEditingClient] = useState<AdminClient | null>(null);
    const [editClientName, setEditClientName] = useState("");
    const [editClientPhone, setEditClientPhone] = useState("");
    const [editClientEmail, setEditClientEmail] = useState("");
    const [clientEditError, setClientEditError] = useState("");
    const [isSavingClient, setIsSavingClient] = useState(false);
    const [adminServices, setAdminServices] = useState<AdminServiceSetting[]>([]);
    const [adminBusinessHours, setAdminBusinessHours] = useState<AdminBusinessHour[]>([]);
    const [settingsError, setSettingsError] = useState("");
    const [settingsSuccess, setSettingsSuccess] = useState("");
    const [savingServiceId, setSavingServiceId] = useState<number | null>(null);
    const [savingHoursId, setSavingHoursId] = useState<number | null>(null);

    useEffect(() => {
        async function checkSession() {
            const {
                data: {session},
            } = await supabase.auth.getSession();

            setIsAuthenticated(Boolean(session));
            setIsCheckingSession(false);
        }

        void checkSession();

        const {
            data: {subscription},
        } = supabase.auth.onAuthStateChange((_event, session) => {
            setIsAuthenticated(Boolean(session));
            setIsCheckingSession(false);
        });

        return () => subscription.unsubscribe();
    }, []);

    useEffect(() => {
        if (!isAuthenticated) {
            setAppointments([]);
            return;
        }

        async function loadAdminAppointments() {
            setIsLoading(true);
            setPanelError("");

            const [
                {data: appointmentData, error: appointmentError},
                {data: blockData, error: blockLoadError},
                {data: serviceData, error: serviceLoadError},
                {data: hoursData, error: hoursLoadError},
            ] = await Promise.all([
                supabase
                    .from("appointments")
                    .select(
                        "id, client_name, client_phone, client_email, service_name, appointment_date, start_time, duration_minutes, status, created_at",
                    )
                    .order("appointment_date", {ascending: true})
                    .order("start_time", {ascending: true}),
                supabase
                    .from("schedule_blocks")
                    .select(
                        "id, block_date, start_time, end_time, reason, created_at",
                    )
                    .order("block_date", {ascending: true})
                    .order("start_time", {ascending: true}),
                supabase
                    .from("services")
                    .select("id, name, description, duration_minutes, price_cents, display_order")
                    .order("display_order", {ascending: true}),
                supabase
                    .from("business_hours")
                    .select("id, day_of_week, start_time, end_time")
                    .order("day_of_week", {ascending: true}),
            ]);

            if (appointmentError || blockLoadError || serviceLoadError || hoursLoadError) {
                console.error(
                    "Erro ao carregar painel:",
                    appointmentError || blockLoadError || serviceLoadError || hoursLoadError,
                );
                setPanelError(
                    "Não foi possível carregar os dados do painel. Tente atualizar a página.",
                );
                setIsLoading(false);
                return;
            }

            setAppointments(
                (appointmentData ?? []) as AdminAppointment[],
            );
            setAdminBlocks((blockData ?? []) as AdminScheduleBlock[]);
            setAdminServices((serviceData ?? []) as AdminServiceSetting[]);
            setAdminBusinessHours(
                ((hoursData ?? []) as AdminBusinessHour[]).map((hours) => ({
                    ...hours,
                    start_time: String(hours.start_time).slice(0, 5),
                    end_time: String(hours.end_time).slice(0, 5),
                })),
            );
            if (serviceData?.length) {
                setManualServiceName(serviceData[0].name);
            }
            setIsLoading(false);
        }

        void loadAdminAppointments();

        const appointmentsChannel = supabase
            .channel("admin-appointments-updates")
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "appointments",
                },
                () => {
                    void loadAdminAppointments();
                },
            )
            .subscribe();

        const blocksChannel = supabase
            .channel("admin-schedule-blocks-updates")
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "schedule_blocks",
                },
                () => {
                    void loadAdminAppointments();
                },
            )
            .subscribe();

        return () => {
            void supabase.removeChannel(appointmentsChannel);
            void supabase.removeChannel(blocksChannel);
        };
    }, [isAuthenticated]);

    async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setLoginError("");
        setIsLoggingIn(true);

        const {error} = await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
        });

        if (error) {
            console.error("Erro de login:", error);
            setLoginError("E-mail ou senha incorretos.");
            setIsLoggingIn(false);
            return;
        }

        setPassword("");
        setIsLoggingIn(false);
    }

    async function handleLogout() {
        await supabase.auth.signOut();
    }

    async function updateAppointmentStatus(
        appointmentId: string,
        status: AdminAppointment["status"],
    ) {
        setUpdatingId(appointmentId);
        setPanelError("");

        const {error} = await supabase
            .from("appointments")
            .update({status})
            .eq("id", appointmentId);

        if (error) {
            console.error("Erro ao atualizar agendamento:", error);
            setPanelError(
                "Não foi possível atualizar o agendamento. Tente novamente.",
            );
            setUpdatingId("");
            return;
        }

        setAppointments((currentAppointments) =>
            currentAppointments.map((appointment) =>
                appointment.id === appointmentId
                    ? {...appointment, status}
                    : appointment,
            ),
        );
        setUpdatingId("");
    }

    function openAppointmentDetails(appointment: AdminAppointment) {
        setSelectedAdminAppointment(appointment);
        setRescheduleDate(appointment.appointment_date);
        setRescheduleTime(String(appointment.start_time).slice(0, 5));
        setRescheduleError("");
    }

    function closeAppointmentDetails() {
        if (isRescheduling) {
            return;
        }

        setSelectedAdminAppointment(null);
        setRescheduleError("");
    }

    function hasAppointmentConflict(
        appointmentId: string,
        date: string,
        time: string,
        durationMinutes: number,
        appointmentsToCheck: AdminAppointment[],
    ) {
        const requestedStart = getMinutesFromTime(time);
        const requestedEnd = requestedStart + durationMinutes;

        return appointmentsToCheck.some((appointment) => {
            if (
                appointment.id === appointmentId ||
                appointment.status === "cancelled" ||
                appointment.appointment_date !== date
            ) {
                return false;
            }

            const existingStart = getMinutesFromTime(appointment.start_time);
            const existingEnd =
                existingStart + appointment.duration_minutes;

            return requestedStart < existingEnd && requestedEnd > existingStart;
        });
    }

    async function handleReschedule() {
        if (!selectedAdminAppointment) {
            return;
        }

        if (!rescheduleDate || !rescheduleTime) {
            setRescheduleError("Escolha a nova data e o novo horário.");
            return;
        }

        const selectedDateValue = new Date(`${rescheduleDate}T12:00:00`);
        const todayValue = new Date();
        todayValue.setHours(0, 0, 0, 0);

        if (selectedDateValue.getTime() < todayValue.getTime()) {
            setRescheduleError("Não é possível reagendar para uma data passada.");
            return;
        }

        const rescheduleStart = getMinutesFromTime(rescheduleTime);
        const rescheduleDay = selectedDateValue.getDay();
        const lastRescheduleStartingTime =
            rescheduleDay === 0 || rescheduleDay === 6 ? 13 * 60 : 19 * 60;

        if (rescheduleStart < 7 * 60 || rescheduleStart > lastRescheduleStartingTime) {
            setRescheduleError(
                rescheduleDay === 0 || rescheduleDay === 6
                    ? "Nos finais de semana, escolha um horário entre 07:00 e 13:00."
                    : "Durante a semana, escolha um horário entre 07:00 e 19:00.",
            );
            return;
        }

        setIsRescheduling(true);
        setRescheduleError("");

        const {data: latestData, error: latestError} = await supabase
            .from("appointments")
            .select(
                "id, client_name, client_phone, client_email, service_name, appointment_date, start_time, duration_minutes, status, created_at",
            )
            .neq("status", "cancelled");

        if (latestError) {
            console.error("Erro ao validar reagendamento:", latestError);
            setRescheduleError(
                "Não foi possível verificar os horários disponíveis.",
            );
            setIsRescheduling(false);
            return;
        }

        const latestAppointments =
            (latestData ?? []) as AdminAppointment[];

        if (
            hasAppointmentConflict(
                selectedAdminAppointment.id,
                rescheduleDate,
                rescheduleTime,
                selectedAdminAppointment.duration_minutes,
                latestAppointments,
            )
        ) {
            setRescheduleError(
                "Este horário entra em conflito com outro agendamento.",
            );
            setIsRescheduling(false);
            return;
        }

        const {error} = await supabase
            .from("appointments")
            .update({
                appointment_date: rescheduleDate,
                start_time: rescheduleTime,
            })
            .eq("id", selectedAdminAppointment.id);

        if (error) {
            console.error("Erro ao reagendar:", error);
            setRescheduleError(
                "Não foi possível salvar o reagendamento. Tente novamente.",
            );
            setIsRescheduling(false);
            return;
        }

        const updatedAppointment = {
            ...selectedAdminAppointment,
            appointment_date: rescheduleDate,
            start_time: rescheduleTime,
        };

        setAppointments((currentAppointments) =>
            currentAppointments.map((appointment) =>
                appointment.id === selectedAdminAppointment.id
                    ? updatedAppointment
                    : appointment,
            ),
        );
        setSelectedAdminAppointment(updatedAppointment);
        setAgendaDate(rescheduleDate);
        setRescheduleError("");
        setIsRescheduling(false);
    }

    function updateAdminServiceField(
        serviceId: number,
        field: "name" | "price_cents" | "duration_minutes",
        value: string,
    ) {
        setAdminServices((current) =>
            current.map((service) =>
                service.id === serviceId
                    ? {
                        ...service,
                        [field]: field === "name" ? value : Math.max(0, Number(value)),
                    }
                    : service,
            ),
        );
    }

    async function saveAdminService(service: AdminServiceSetting) {
        setSettingsError("");
        setSettingsSuccess("");

        if (service.name.trim().length < 2) {
            setSettingsError("O nome do serviço precisa ter pelo menos 2 caracteres.");
            return;
        }
        if (service.price_cents < 0 || service.duration_minutes <= 0) {
            setSettingsError("Informe um preço válido e uma duração maior que zero.");
            return;
        }

        setSavingServiceId(service.id);
        const {error} = await supabase
            .from("services")
            .update({
                name: service.name.trim(),
                price_cents: Math.round(service.price_cents),
                duration_minutes: Math.round(service.duration_minutes),
            })
            .eq("id", service.id);

        if (error) {
            console.error("Erro ao salvar serviço:", error);
            setSettingsError("Não foi possível salvar o serviço. Verifique se o nome não está repetido.");
        } else {
            setAdminServices((current) =>
                current.map((item) =>
                    item.id === service.id
                        ? {...service, name: service.name.trim()}
                        : item,
                ),
            );
            setSettingsSuccess(`Serviço “${service.name.trim()}” atualizado com sucesso.`);
        }
        setSavingServiceId(null);
    }

    function updateAdminHoursField(
        hoursId: number,
        field: "start_time" | "end_time",
        value: string,
    ) {
        setAdminBusinessHours((current) =>
            current.map((hours) =>
                hours.id === hoursId ? {...hours, [field]: value} : hours,
            ),
        );
    }

    async function saveAdminHours(hours: AdminBusinessHour) {
        setSettingsError("");
        setSettingsSuccess("");

        if (!hours.start_time || !hours.end_time || hours.start_time >= hours.end_time) {
            setSettingsError("O horário final deve ser posterior ao horário inicial.");
            return;
        }

        setSavingHoursId(hours.id);
        const {error} = await supabase
            .from("business_hours")
            .update({start_time: hours.start_time, end_time: hours.end_time})
            .eq("id", hours.id);

        if (error) {
            console.error("Erro ao salvar horário:", error);
            setSettingsError("Não foi possível salvar o horário de atendimento.");
        } else {
            setSettingsSuccess(`${dayNames[hours.day_of_week]} atualizado com sucesso.`);
        }
        setSavingHoursId(null);
    }

    function resetManualAppointmentForm() {
        setManualClientName("");
        setManualClientPhone("");
        setManualClientEmail("");
        setManualServiceName(adminServices[0]?.name ?? fallbackServices[0].name);
        setManualDate(formatDateForInput(new Date()));
        setManualTime("07:00");
        setManualError("");
        setManualSuccess("");
    }

    async function createManualAppointment(
        event: React.FormEvent<HTMLFormElement>,
    ) {
        event.preventDefault();
        setManualError("");
        setManualSuccess("");

        const selectedService = adminServices.find(
            (service) => service.name === manualServiceName,
        );

        if (!selectedService) {
            setManualError("Selecione um serviço válido.");
            return;
        }

        if (!manualClientName.trim() || !manualClientPhone.trim()) {
            setManualError("Preencha o nome e o telefone da cliente.");
            return;
        }

        if (!manualDate || !manualTime) {
            setManualError("Escolha a data e o horário.");
            return;
        }

        const selectedDateValue = new Date(`${manualDate}T12:00:00`);
        const todayValue = new Date();
        todayValue.setHours(0, 0, 0, 0);

        if (selectedDateValue.getTime() < todayValue.getTime()) {
            setManualError("Não é possível agendar em uma data passada.");
            return;
        }

        const requestedStart = getMinutesFromTime(manualTime);
        const requestedEnd =
            requestedStart + selectedService.duration_minutes;
        const selectedDay = selectedDateValue.getDay();
        const lastStartingMinutes =
            selectedDay === 0 || selectedDay === 6 ? 13 * 60 : 19 * 60;

        if (requestedStart < 7 * 60 || requestedStart > lastStartingMinutes) {
            setManualError(
                selectedDay === 0 || selectedDay === 6
                    ? "Nos finais de semana, o último horário de início é 13:00."
                    : "Durante a semana, o último horário de início é 19:00.",
            );
            return;
        }

        setIsSavingManualAppointment(true);

        const [
            {data: latestAppointmentsData, error: appointmentsError},
            {data: latestBlocksData, error: blocksError},
        ] = await Promise.all([
            supabase
                .from("appointments")
                .select(
                    "id, client_name, client_phone, client_email, service_name, appointment_date, start_time, duration_minutes, status, created_at",
                )
                .eq("appointment_date", manualDate)
                .neq("status", "cancelled"),
            supabase
                .from("schedule_blocks")
                .select(
                    "id, block_date, start_time, end_time, reason, created_at",
                )
                .eq("block_date", manualDate),
        ]);

        if (appointmentsError || blocksError) {
            console.error(
                "Erro ao validar novo agendamento:",
                appointmentsError || blocksError,
            );
            setManualError(
                "Não foi possível verificar a disponibilidade do horário.",
            );
            setIsSavingManualAppointment(false);
            return;
        }

        const latestAppointments =
            (latestAppointmentsData ?? []) as AdminAppointment[];
        const latestBlocks =
            (latestBlocksData ?? []) as AdminScheduleBlock[];

        const conflictsWithAppointment = latestAppointments.some(
            (appointment) => {
                const existingStart = getMinutesFromTime(
                    appointment.start_time,
                );
                const existingEnd =
                    existingStart + appointment.duration_minutes;

                return (
                    requestedStart < existingEnd &&
                    requestedEnd > existingStart
                );
            },
        );

        const conflictsWithBlock = latestBlocks.some((block) => {
            const blockStart = getMinutesFromTime(block.start_time);
            const blockEnd = getMinutesFromTime(block.end_time);

            return requestedStart < blockEnd && requestedEnd > blockStart;
        });

        if (conflictsWithAppointment || conflictsWithBlock) {
            setManualError(
                "Esse horário não está disponível para a duração do serviço escolhido.",
            );
            setIsSavingManualAppointment(false);
            return;
        }

        const {data, error} = await supabase
            .from("appointments")
            .insert({
                client_name: manualClientName.trim(),
                client_phone: manualClientPhone.trim(),
                client_email: manualClientEmail.trim() || null,
                service_name: selectedService.name,
                appointment_date: manualDate,
                start_time: manualTime,
                duration_minutes: selectedService.duration_minutes,
                status: "confirmed",
            })
            .select(
                "id, client_name, client_phone, client_email, service_name, appointment_date, start_time, duration_minutes, status, created_at",
            )
            .single();

        if (error) {
            console.error("Erro ao criar agendamento manual:", error);
            setManualError(
                "Não foi possível salvar o agendamento. Verifique os dados e tente novamente.",
            );
            setIsSavingManualAppointment(false);
            return;
        }

        const createdAppointment = data as AdminAppointment;

        setAppointments((current) =>
            [...current, createdAppointment].sort((first, second) =>
                `${first.appointment_date}${first.start_time}`.localeCompare(
                    `${second.appointment_date}${second.start_time}`,
                ),
            ),
        );
        setAgendaDate(manualDate);
        setManualSuccess(
            `Agendamento de ${createdAppointment.client_name} criado com sucesso.`,
        );
        setManualClientName("");
        setManualClientPhone("");
        setManualClientEmail("");
        setIsSavingManualAppointment(false);
    }

    async function createScheduleBlock(
        event: React.FormEvent<HTMLFormElement>,
    ) {
        event.preventDefault();
        setBlockError("");

        if (!blockDate || !blockStartTime || !blockEndTime) {
            setBlockError("Preencha a data e os horários do bloqueio.");
            return;
        }

        const start = getMinutesFromTime(blockStartTime);
        const end = getMinutesFromTime(blockEndTime);

        if (end <= start) {
            setBlockError(
                "O horário final precisa ser posterior ao horário inicial.",
            );
            return;
        }

        const conflictsWithAppointment = appointments.some((appointment) => {
            if (
                appointment.status === "cancelled" ||
                appointment.appointment_date !== blockDate
            ) {
                return false;
            }

            const appointmentStart = getMinutesFromTime(
                appointment.start_time,
            );
            const appointmentEnd =
                appointmentStart + appointment.duration_minutes;

            return start < appointmentEnd && end > appointmentStart;
        });

        if (conflictsWithAppointment) {
            setBlockError(
                "Esse período possui um agendamento e não pode ser bloqueado.",
            );
            return;
        }

        const conflictsWithBlock = adminBlocks.some((block) => {
            if (block.block_date !== blockDate) {
                return false;
            }

            const existingStart = getMinutesFromTime(block.start_time);
            const existingEnd = getMinutesFromTime(block.end_time);

            return start < existingEnd && end > existingStart;
        });

        if (conflictsWithBlock) {
            setBlockError("Esse período já possui outro bloqueio.");
            return;
        }

        setIsSavingBlock(true);

        const {data, error} = await supabase
            .from("schedule_blocks")
            .insert({
                block_date: blockDate,
                start_time: blockStartTime,
                end_time: blockEndTime,
                reason: blockReason.trim() || null,
            })
            .select(
                "id, block_date, start_time, end_time, reason, created_at",
            )
            .single();

        if (error) {
            console.error("Erro ao criar bloqueio:", error);
            setBlockError("Não foi possível bloquear esse horário.");
            setIsSavingBlock(false);
            return;
        }

        setAdminBlocks((current) =>
            [...current, data as AdminScheduleBlock].sort((first, second) =>
                `${first.block_date}${first.start_time}`.localeCompare(
                    `${second.block_date}${second.start_time}`,
                ),
            ),
        );
        setAgendaDate(blockDate);
        setBlockReason("");
        setBlockError("");
        setIsSavingBlock(false);
    }

    async function deleteScheduleBlock(blockId: string) {
        setBlockError("");

        const {error} = await supabase
            .from("schedule_blocks")
            .delete()
            .eq("id", blockId);

        if (error) {
            console.error("Erro ao remover bloqueio:", error);
            setBlockError("Não foi possível remover o bloqueio.");
            return;
        }

        setAdminBlocks((current) =>
            current.filter((block) => block.id !== blockId),
        );
    }

    function openClientEditor(client: AdminClient) {
        setEditingClient(client);
        setEditClientName(client.name);
        setEditClientPhone(client.phone);
        setEditClientEmail(client.email);
        setClientEditError("");
    }

    function closeClientEditor() {
        if (isSavingClient) {
            return;
        }

        setEditingClient(null);
        setClientEditError("");
    }

    async function saveClientChanges(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();

        if (!editingClient) {
            return;
        }

        const normalizedName = editClientName.trim().replace(/\s+/g, " ");
        const normalizedPhone = formatBrazilianPhone(editClientPhone);
        const phoneDigits = normalizedPhone.replace(/\D/g, "");
        const normalizedEmail = editClientEmail.trim();

        if (normalizedName.length < 3) {
            setClientEditError("Informe o nome completo da cliente.");
            return;
        }

        if (phoneDigits.length < 10 || phoneDigits.length > 11) {
            setClientEditError("Informe um telefone válido com DDD.");
            return;
        }

        setIsSavingClient(true);
        setClientEditError("");

        const appointmentIds = editingClient.appointments.map(
            (appointment) => appointment.id,
        );

        const {error} = await supabase
            .from("appointments")
            .update({
                client_name: normalizedName,
                client_phone: normalizedPhone,
                client_email: normalizedEmail || null,
            })
            .in("id", appointmentIds);

        if (error) {
            console.error("Erro ao atualizar cadastro da cliente:", error);
            setClientEditError(
                "Não foi possível atualizar o cadastro. Tente novamente.",
            );
            setIsSavingClient(false);
            return;
        }

        setAppointments((currentAppointments) =>
            currentAppointments.map((appointment) =>
                appointmentIds.includes(appointment.id)
                    ? {
                        ...appointment,
                        client_name: normalizedName,
                        client_phone: normalizedPhone,
                        client_email: normalizedEmail || null,
                    }
                    : appointment,
            ),
        );

        setSelectedClient((currentClient) =>
            currentClient?.key === editingClient.key
                ? {
                    ...currentClient,
                    name: normalizedName,
                    phone: normalizedPhone,
                    email: normalizedEmail,
                    appointments: currentClient.appointments.map(
                        (appointment) => ({
                            ...appointment,
                            client_name: normalizedName,
                            client_phone: normalizedPhone,
                            client_email: normalizedEmail || null,
                        }),
                    ),
                }
                : currentClient,
        );

        setEditingClient(null);
        setIsSavingClient(false);
    }

    const clients = useMemo<AdminClient[]>(() => {
        const groupedClients = new Map<string, AdminAppointment[]>();

        appointments.forEach((appointment) => {
            const phoneDigits = appointment.client_phone.replace(/\D/g, "");
            const fallbackKey = appointment.client_name
                .trim()
                .toLowerCase()
                .replace(/\s+/g, "-");
            const key = phoneDigits || fallbackKey;
            const current = groupedClients.get(key) ?? [];
            current.push(appointment);
            groupedClients.set(key, current);
        });

        const now = new Date();

        return Array.from(groupedClients.entries())
            .map(([key, clientAppointments]) => {
                const ordered = [...clientAppointments].sort(
                    (first, second) =>
                        getAppointmentDateTime(second).getTime() -
                        getAppointmentDateTime(first).getTime(),
                );
                const reference = ordered[0];
                const completedOrPast = ordered.filter(
                    (appointment) =>
                        appointment.status !== "cancelled" &&
                        getAppointmentDateTime(appointment).getTime() <
                        now.getTime(),
                );
                const upcoming = [...ordered]
                    .filter(
                        (appointment) =>
                            appointment.status !== "cancelled" &&
                            getAppointmentDateTime(appointment).getTime() >=
                            now.getTime(),
                    )
                    .sort(
                        (first, second) =>
                            getAppointmentDateTime(first).getTime() -
                            getAppointmentDateTime(second).getTime(),
                    );

                return {
                    key,
                    name: reference.client_name,
                    phone: reference.client_phone,
                    email: reference.client_email ?? "",
                    appointments: ordered,
                    lastAppointment: completedOrPast[0] ?? null,
                    nextAppointment: upcoming[0] ?? null,
                };
            })
            .sort((first, second) =>
                first.name.localeCompare(second.name, "pt-BR"),
            );
    }, [appointments]);

    const filteredClients = useMemo(() => {
        const normalizedSearch = clientSearch.trim().toLowerCase();
        const searchDigits = clientSearch.replace(/\D/g, "");

        if (!normalizedSearch) {
            return clients;
        }

        return clients.filter(
            (client) =>
                client.name.toLowerCase().includes(normalizedSearch) ||
                client.phone.toLowerCase().includes(normalizedSearch) ||
                (searchDigits &&
                    client.phone.replace(/\D/g, "").includes(searchDigits)),
        );
    }, [clientSearch, clients]);

    const filteredAppointments = useMemo(() => {
        const normalizedSearch = search.trim().toLowerCase();

        return appointments.filter((appointment) => {
            const matchesSearch =
                !normalizedSearch ||
                appointment.client_name.toLowerCase().includes(normalizedSearch) ||
                appointment.client_phone.includes(normalizedSearch) ||
                appointment.service_name.toLowerCase().includes(normalizedSearch);

            const matchesDate =
                !dateFilter || appointment.appointment_date === dateFilter;

            const matchesStatus =
                statusFilter === "all" ||
                (statusFilter === "active" &&
                    appointment.status !== "cancelled") ||
                appointment.status === statusFilter;

            return matchesSearch && matchesDate && matchesStatus;
        });
    }, [appointments, dateFilter, search, statusFilter]);

    const weekDates = useMemo(() => {
        const selected = new Date(`${agendaDate}T12:00:00`);
        const dayOfWeek = selected.getDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const monday = addDaysToInputDate(agendaDate, mondayOffset);

        return Array.from({length: 7}, (_, index) =>
            addDaysToInputDate(monday, index),
        );
    }, [agendaDate]);

    const weekStartLabel = formatAdminDate(weekDates[0]);
    const weekEndLabel = formatAdminDate(weekDates[6]);

    const agendaBlocks = useMemo(
        () =>
            adminBlocks
                .filter((block) => block.block_date === agendaDate)
                .sort(
                    (first, second) =>
                        getMinutesFromTime(first.start_time) -
                        getMinutesFromTime(second.start_time),
                ),
        [adminBlocks, agendaDate],
    );

    const agendaAppointments = useMemo(() => {
        const normalizedSearch = search.trim().toLowerCase();

        return appointments
            .filter((appointment) => {
                const matchesDate =
                    appointment.appointment_date === agendaDate;
                const matchesSearch =
                    !normalizedSearch ||
                    appointment.client_name
                        .toLowerCase()
                        .includes(normalizedSearch) ||
                    appointment.client_phone.includes(normalizedSearch) ||
                    appointment.service_name
                        .toLowerCase()
                        .includes(normalizedSearch);
                const matchesStatus =
                    statusFilter === "all" ||
                    (statusFilter === "active" &&
                        appointment.status !== "cancelled") ||
                    appointment.status === statusFilter;

                return matchesDate && matchesSearch && matchesStatus;
            })
            .sort(
                (first, second) =>
                    getMinutesFromTime(first.start_time) -
                    getMinutesFromTime(second.start_time),
            );
    }, [agendaDate, appointments, search, statusFilter]);

    const nextAppointment = useMemo(() => {
        const now = new Date();

        return appointments
            .filter(
                (appointment) =>
                    appointment.status !== "cancelled" &&
                    getAppointmentDateTime(appointment).getTime() >=
                    now.getTime(),
            )
            .sort(
                (first, second) =>
                    getAppointmentDateTime(first).getTime() -
                    getAppointmentDateTime(second).getTime(),
            )[0];
    }, [appointments]);

    if (isCheckingSession) {
        return (
            <main className="admin-page">
                <style>{adminStyles}</style>
                <div className="admin-login">
                    <div className="admin-loading">Verificando acesso...</div>
                </div>
            </main>
        );
    }

    if (!isAuthenticated) {
        return (
            <main className="admin-page">
                <style>{adminStyles}</style>
                <div className="admin-login">
                    <form className="admin-login__card" onSubmit={handleLogin}>
                        <div className="admin-login__brand">
                            <span className="admin-login__symbol">MS</span>
                            <div>
                                <strong>Mirian Silva</strong>
                                <span>Painel administrativo</span>
                            </div>
                        </div>

                        <h1>Acesso da Mirian</h1>
                        <p>
                            Entre com o e-mail e a senha cadastrados no
                            Supabase.
                        </p>

                        {loginError && (
                            <p className="admin-login__error">{loginError}</p>
                        )}

                        <div className="admin-field">
                            <label htmlFor="admin-email">E-mail</label>
                            <input
                                id="admin-email"
                                type="email"
                                autoComplete="email"
                                value={email}
                                onChange={(event) => setEmail(event.target.value)}
                                required
                            />
                        </div>

                        <div className="admin-field">
                            <label htmlFor="admin-password">Senha</label>
                            <input
                                id="admin-password"
                                type="password"
                                autoComplete="current-password"
                                value={password}
                                onChange={(event) =>
                                    setPassword(event.target.value)
                                }
                                required
                            />
                        </div>

                        <button
                            className="admin-primary-button"
                            type="submit"
                            disabled={isLoggingIn}
                        >
                            {isLoggingIn ? "Entrando..." : "Entrar no painel"}
                        </button>
                    </form>
                </div>
            </main>
        );
    }

    return (
        <main className="admin-page">
            <style>{adminStyles}</style>

            <section className="admin-panel">
                <header className="admin-header">
                    <div>
                        <h1>Painel da Mirian</h1>
                        <p>Gerencie os agendamentos recebidos pelo site.</p>
                    </div>

                    <button
                        className="admin-secondary-button"
                        type="button"
                        onClick={handleLogout}
                    >
                        Sair
                    </button>
                </header>

                {nextAppointment && (
                    <div className="admin-next-appointment">
                        <span>Próximo atendimento</span>
                        <strong>
                            {nextAppointment.client_name} •{" "}
                            {String(nextAppointment.start_time).slice(0, 5)}
                        </strong>
                        <small>
                            {formatAdminDate(
                                nextAppointment.appointment_date,
                            )}{" "}
                            — {nextAppointment.service_name}
                        </small>
                    </div>
                )}

                <div className="admin-view-controls">
                    <div className="admin-view-switch">
                        <button
                            type="button"
                            className={
                                adminView === "agenda" ? "is-active" : ""
                            }
                            onClick={() => setAdminView("agenda")}
                        >
                            Agenda do dia
                        </button>
                        <button
                            type="button"
                            className={
                                adminView === "week" ? "is-active" : ""
                            }
                            onClick={() => setAdminView("week")}
                        >
                            Agenda semanal
                        </button>
                        <button
                            type="button"
                            className={
                                adminView === "clients" ? "is-active" : ""
                            }
                            onClick={() => setAdminView("clients")}
                        >
                            Clientes
                        </button>
                        <button
                            type="button"
                            className={adminView === "settings" ? "is-active" : ""}
                            onClick={() => setAdminView("settings")}
                        >
                            Configurações
                        </button>
                    </div>

                    {(adminView === "agenda" || adminView === "week") && (
                        <div className="admin-date-navigation">
                            <button
                                type="button"
                                aria-label={
                                    adminView === "week"
                                        ? "Semana anterior"
                                        : "Dia anterior"
                                }
                                onClick={() =>
                                    setAgendaDate((current) =>
                                        addDaysToInputDate(
                                            current,
                                            adminView === "week" ? -7 : -1,
                                        ),
                                    )
                                }
                            >
                                ←
                            </button>
                            <div className="admin-selected-date">
                                {adminView === "week"
                                    ? `${weekStartLabel} até ${weekEndLabel}`
                                    : formatAdminDate(agendaDate)}
                            </div>
                            <button
                                type="button"
                                aria-label={
                                    adminView === "week"
                                        ? "Próxima semana"
                                        : "Próximo dia"
                                }
                                onClick={() =>
                                    setAgendaDate((current) =>
                                        addDaysToInputDate(
                                            current,
                                            adminView === "week" ? 7 : 1,
                                        ),
                                    )
                                }
                            >
                                →
                            </button>
                            <button
                                className="admin-today-button"
                                type="button"
                                onClick={() =>
                                    setAgendaDate(formatDateForInput(new Date()))
                                }
                            >
                                Hoje
                            </button>
                        </div>
                    )}
                </div>

                {adminView === "settings" ? (
                    <section className="admin-settings">
                        <div className="admin-settings__intro">
                            <div>
                                <span className="admin-settings__eyebrow">Configurações do site</span>
                                <h2>Serviços e horários</h2>
                                <p>As alterações salvas aqui aparecem no agendamento das clientes.</p>
                            </div>
                        </div>

                        {settingsError && (
                            <p className="admin-settings__message admin-settings__message--error">{settingsError}</p>
                        )}
                        {settingsSuccess && (
                            <p className="admin-settings__message admin-settings__message--success">{settingsSuccess}</p>
                        )}

                        <div className="admin-settings__section">
                            <div className="admin-settings__section-header">
                                <h3>Serviços</h3>
                                <p>Edite o nome, o preço e a duração de cada atendimento.</p>
                            </div>
                            <div className="admin-settings__list">
                                {adminServices.map((service) => (
                                    <article className="admin-settings__service" key={service.id}>
                                        <label>
                                            Nome do serviço
                                            <input
                                                value={service.name}
                                                onChange={(event) => updateAdminServiceField(service.id, "name", event.target.value)}
                                            />
                                        </label>
                                        <label>
                                            Preço (R$)
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                value={(service.price_cents / 100).toFixed(2)}
                                                onChange={(event) => updateAdminServiceField(service.id, "price_cents", String(Math.round(Number(event.target.value) * 100)))}
                                            />
                                        </label>
                                        <label>
                                            Duração (minutos)
                                            <input
                                                type="number"
                                                min="1"
                                                step="5"
                                                value={service.duration_minutes}
                                                onChange={(event) => updateAdminServiceField(service.id, "duration_minutes", event.target.value)}
                                            />
                                        </label>
                                        <button type="button" disabled={savingServiceId === service.id}
                                                onClick={() => void saveAdminService(service)}>
                                            {savingServiceId === service.id ? "Salvando..." : "Salvar"}
                                        </button>
                                    </article>
                                ))}
                            </div>
                        </div>

                        <div className="admin-settings__section">
                            <div className="admin-settings__section-header">
                                <h3>Horários de atendimento</h3>
                                <p>Defina o início e o fim do expediente de cada dia.</p>
                            </div>
                            <div className="admin-settings__list">
                                {adminBusinessHours.map((hours) => (
                                    <article className="admin-settings__hours" key={hours.id}>
                                        <strong>{dayNames[hours.day_of_week]}</strong>
                                        <label>
                                            Início
                                            <input type="time" value={hours.start_time}
                                                   onChange={(event) => updateAdminHoursField(hours.id, "start_time", event.target.value)}/>
                                        </label>
                                        <label>
                                            Final
                                            <input type="time" value={hours.end_time}
                                                   onChange={(event) => updateAdminHoursField(hours.id, "end_time", event.target.value)}/>
                                        </label>
                                        <button type="button" disabled={savingHoursId === hours.id}
                                                onClick={() => void saveAdminHours(hours)}>
                                            {savingHoursId === hours.id ? "Salvando..." : "Salvar"}
                                        </button>
                                    </article>
                                ))}
                            </div>
                        </div>
                    </section>
                ) : adminView === "clients" ? (
                    <section className="admin-clients">
                        <div className="admin-clients__header">
                            <div>
                                <span className="admin-clients__eyebrow">
                                    Relacionamento
                                </span>
                                <h2>Clientes</h2>
                                <p>
                                    Consulte o histórico, o último atendimento e
                                    os dados de contato de cada cliente.
                                </p>
                            </div>
                            <div className="admin-clients__count">
                                <strong>{clients.length}</strong>
                                <span>
                                    {clients.length === 1
                                        ? "cliente cadastrada"
                                        : "clientes cadastradas"}
                                </span>
                            </div>
                        </div>

                        <div className="admin-clients__search">
                            <label htmlFor="client-admin-search">
                                Buscar por nome ou telefone
                            </label>
                            <input
                                id="client-admin-search"
                                type="search"
                                placeholder="Ex.: Maria ou (48) 99999-9999"
                                value={clientSearch}
                                onChange={(event) =>
                                    setClientSearch(event.target.value)
                                }
                            />
                        </div>

                        {filteredClients.length === 0 ? (
                            <div className="admin-empty">
                                Nenhuma cliente encontrada.
                            </div>
                        ) : (
                            <div className="admin-clients__grid">
                                {filteredClients.map((client) => (
                                    <article
                                        className="admin-client-card"
                                        key={client.key}
                                    >
                                        <div className="admin-client-card__top">
                                            <div className="admin-client-card__avatar">
                                                {client.name
                                                    .split(" ")
                                                    .slice(0, 2)
                                                    .map((part) => part[0])
                                                    .join("")
                                                    .toUpperCase()}
                                            </div>
                                            <div>
                                                <h3>{client.name}</h3>
                                                <a
                                                    href={`https://wa.me/${normalizePhoneForWhatsApp(
                                                        client.phone,
                                                    )}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                >
                                                    {client.phone}
                                                </a>
                                                {client.email && (
                                                    <span>{client.email}</span>
                                                )}
                                            </div>
                                        </div>

                                        <div className="admin-client-card__metrics">
                                            <div>
                                                <span>Atendimentos</span>
                                                <strong>
                                                    {
                                                        client.appointments
                                                            .length
                                                    }
                                                </strong>
                                            </div>
                                            <div>
                                                <span>Último atendimento</span>
                                                <strong>
                                                    {client.lastAppointment
                                                        ? formatAdminDate(
                                                            client
                                                                .lastAppointment
                                                                .appointment_date,
                                                        )
                                                        : "Ainda não realizado"}
                                                </strong>
                                            </div>
                                        </div>

                                        {client.nextAppointment && (
                                            <div className="admin-client-card__next">
                                                <span>Próximo</span>
                                                <strong>
                                                    {formatAdminDate(
                                                        client.nextAppointment
                                                            .appointment_date,
                                                    )}{" "}
                                                    às{" "}
                                                    {String(
                                                        client.nextAppointment
                                                            .start_time,
                                                    ).slice(0, 5)}
                                                </strong>
                                            </div>
                                        )}

                                        <div className="admin-client-card__actions">
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setSelectedClient(client)
                                                }
                                            >
                                                Ver histórico
                                            </button>
                                            <button
                                                type="button"
                                                className="is-secondary"
                                                onClick={() =>
                                                    openClientEditor(client)
                                                }
                                            >
                                                Editar cadastro
                                            </button>
                                        </div>
                                    </article>
                                ))}
                            </div>
                        )}
                    </section>
                ) : (
                    <>
                        <section className="admin-new-appointment">
                            <div className="admin-new-appointment__header">
                                <div>
                                    <h2>Novo agendamento</h2>
                                    <p>
                                        Cadastre horários marcados por telefone,
                                        WhatsApp ou pessoalmente.
                                    </p>
                                </div>
                                <button
                                    className="admin-new-appointment__toggle"
                                    type="button"
                                    onClick={() => {
                                        if (showManualForm) {
                                            resetManualAppointmentForm();
                                        }
                                        setShowManualForm((current) => !current);
                                    }}
                                >
                                    {showManualForm ? "Fechar" : "+ Adicionar"}
                                </button>
                            </div>

                            {showManualForm && (
                                <form
                                    className="admin-manual-form"
                                    onSubmit={createManualAppointment}
                                >
                                    <label>
                                        Nome da cliente
                                        <input
                                            type="text"
                                            value={manualClientName}
                                            onChange={(event) =>
                                                setManualClientName(
                                                    event.target.value,
                                                )
                                            }
                                            placeholder="Nome completo"
                                            required
                                        />
                                    </label>

                                    <label>
                                        Telefone
                                        <input
                                            type="tel"
                                            value={manualClientPhone}
                                            onChange={(event) =>
                                                setManualClientPhone(
                                                    event.target.value,
                                                )
                                            }
                                            placeholder="(48) 99999-9999"
                                            required
                                        />
                                    </label>

                                    <label className="admin-manual-form__email">
                                        E-mail
                                        <input
                                            type="email"
                                            value={manualClientEmail}
                                            onChange={(event) =>
                                                setManualClientEmail(
                                                    event.target.value,
                                                )
                                            }
                                            placeholder="Opcional"
                                        />
                                    </label>

                                    <label>
                                        Serviço
                                        <select
                                            value={manualServiceName}
                                            onChange={(event) =>
                                                setManualServiceName(
                                                    event.target.value,
                                                )
                                            }
                                        >
                                            {adminServices.map((service) => (
                                                <option
                                                    key={service.name}
                                                    value={service.name}
                                                >
                                                    {service.name} —{" "}
                                                    {service.duration_minutes} min
                                                </option>
                                            ))}
                                        </select>
                                    </label>

                                    <label>
                                        Data
                                        <input
                                            type="date"
                                            min={formatDateForInput(new Date())}
                                            value={manualDate}
                                            onChange={(event) =>
                                                setManualDate(event.target.value)
                                            }
                                            required
                                        />
                                    </label>

                                    <label>
                                        Horário
                                        <select
                                            value={manualTime}
                                            onChange={(event) =>
                                                setManualTime(event.target.value)
                                            }
                                        >
                                            {Array.from(
                                                {length: 25},
                                                (_, index) => {
                                                    const totalMinutes =
                                                        7 * 60 + index * 30;
                                                    const hours = Math.floor(
                                                        totalMinutes / 60,
                                                    );
                                                    const minutes =
                                                        totalMinutes % 60;
                                                    const value = `${String(
                                                        hours,
                                                    ).padStart(2, "0")}:${String(
                                                        minutes,
                                                    ).padStart(2, "0")}`;

                                                    return (
                                                        <option
                                                            key={value}
                                                            value={value}
                                                        >
                                                            {value}
                                                        </option>
                                                    );
                                                },
                                            )}
                                        </select>
                                    </label>

                                    <div className="admin-manual-form__actions">
                                        <button
                                            className="admin-manual-form__save"
                                            type="submit"
                                            disabled={isSavingManualAppointment}
                                        >
                                            {isSavingManualAppointment
                                                ? "Salvando..."
                                                : "Criar agendamento"}
                                        </button>
                                        <button
                                            className="admin-manual-form__cancel"
                                            type="button"
                                            onClick={() => {
                                                resetManualAppointmentForm();
                                                setShowManualForm(false);
                                            }}
                                        >
                                            Cancelar
                                        </button>
                                    </div>

                                    {manualError && (
                                        <p className="admin-manual-form__error">
                                            {manualError}
                                        </p>
                                    )}

                                    {manualSuccess && (
                                        <p className="admin-manual-form__success">
                                            {manualSuccess}
                                        </p>
                                    )}
                                </form>
                            )}
                        </section>

                        <section className="admin-block-manager">
                            <div className="admin-block-manager__header">
                                <div>
                                    <h2>Bloquear horário</h2>
                                    <p>
                                        Use para almoço, compromissos, folgas ou qualquer
                                        período indisponível.
                                    </p>
                                </div>
                            </div>

                            <form
                                className="admin-block-form"
                                onSubmit={createScheduleBlock}
                            >
                                <label>
                                    Data
                                    <input
                                        type="date"
                                        min={formatDateForInput(new Date())}
                                        value={blockDate}
                                        onChange={(event) =>
                                            setBlockDate(event.target.value)
                                        }
                                        required
                                    />
                                </label>
                                <label>
                                    Início
                                    <input
                                        type="time"
                                        value={blockStartTime}
                                        onChange={(event) =>
                                            setBlockStartTime(event.target.value)
                                        }
                                        required
                                    />
                                </label>
                                <label>
                                    Fim
                                    <input
                                        type="time"
                                        value={blockEndTime}
                                        onChange={(event) =>
                                            setBlockEndTime(event.target.value)
                                        }
                                        required
                                    />
                                </label>
                                <label>
                                    Motivo
                                    <input
                                        type="text"
                                        placeholder="Ex.: almoço ou compromisso"
                                        value={blockReason}
                                        onChange={(event) =>
                                            setBlockReason(event.target.value)
                                        }
                                    />
                                </label>
                                <button type="submit" disabled={isSavingBlock}>
                                    {isSavingBlock ? "Bloqueando..." : "Bloquear"}
                                </button>
                            </form>

                            {blockError && (
                                <p className="admin-block-error">{blockError}</p>
                            )}

                            {adminBlocks.filter(
                                (block) => block.block_date === blockDate,
                            ).length > 0 && (
                                <div className="admin-block-list">
                                    {adminBlocks
                                        .filter(
                                            (block) =>
                                                block.block_date === blockDate,
                                        )
                                        .map((block) => (
                                            <div
                                                className="admin-block-item"
                                                key={block.id}
                                            >
                                                <div>
                                                    <strong>
                                                        {String(
                                                            block.start_time,
                                                        ).slice(0, 5)}{" "}
                                                        até{" "}
                                                        {String(
                                                            block.end_time,
                                                        ).slice(0, 5)}
                                                    </strong>
                                                    <span>
                                                {block.reason ||
                                                    "Horário indisponível"}
                                            </span>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        deleteScheduleBlock(block.id)
                                                    }
                                                >
                                                    Remover
                                                </button>
                                            </div>
                                        ))}
                                </div>
                            )}
                        </section>

                        <div className="admin-toolbar">
                            <input
                                type="search"
                                placeholder="Buscar cliente, telefone ou serviço"
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                            />
                            {adminView === "list" ? (
                                <input
                                    type="date"
                                    value={dateFilter}
                                    onChange={(event) =>
                                        setDateFilter(event.target.value)
                                    }
                                />
                            ) : (
                                <input
                                    type="date"
                                    value={agendaDate}
                                    onChange={(event) =>
                                        setAgendaDate(event.target.value)
                                    }
                                />
                            )}
                            <select
                                value={statusFilter}
                                onChange={(event) =>
                                    setStatusFilter(event.target.value)
                                }
                            >
                                <option value="active">Ativos</option>
                                <option value="all">Todos</option>
                                <option value="confirmed">Confirmados</option>
                                <option value="cancelled">Cancelados</option>
                            </select>
                        </div>

                        {panelError && (
                            <p className="admin-panel__error">{panelError}</p>
                        )}

                        {isLoading ? (
                            <div className="admin-loading">
                                Carregando agendamentos...
                            </div>
                        ) : adminView === "agenda" ? (
                            <div className="admin-agenda">
                                <div className="admin-agenda__hours">
                                    {Array.from({length: 14}, (_, index) => {
                                        const hour = 7 + index;
                                        return (
                                            <div
                                                className="admin-agenda__hour-label"
                                                key={hour}
                                            >
                                                {String(hour).padStart(2, "0")}:00
                                            </div>
                                        );
                                    })}
                                </div>

                                <div className="admin-agenda__canvas">
                                    {agendaAppointments.length === 0 &&
                                        agendaBlocks.length === 0 && (
                                            <div className="admin-agenda__empty">
                                                Nenhum agendamento ou bloqueio para este
                                                dia.
                                            </div>
                                        )}

                                    {agendaBlocks.map((block) => {
                                        const startMinutes =
                                            getMinutesFromTime(block.start_time) -
                                            7 * 60;
                                        const duration =
                                            getMinutesFromTime(block.end_time) -
                                            getMinutesFromTime(block.start_time);
                                        const top = Math.max(
                                            0,
                                            (startMinutes / 60) * 76,
                                        );
                                        const height = Math.max(
                                            46,
                                            (duration / 60) * 76 - 7,
                                        );

                                        return (
                                            <article
                                                className="admin-agenda__block"
                                                key={block.id}
                                                style={{
                                                    top: `${top}px`,
                                                    height: `${height}px`,
                                                }}
                                            >
                                                <strong>
                                                    Bloqueado •{" "}
                                                    {String(block.start_time).slice(
                                                        0,
                                                        5,
                                                    )}{" "}
                                                    –{" "}
                                                    {String(block.end_time).slice(
                                                        0,
                                                        5,
                                                    )}
                                                </strong>
                                                <span>
                                            {block.reason ||
                                                "Horário indisponível"}
                                        </span>
                                            </article>
                                        );
                                    })}

                                    {agendaAppointments.map((appointment) => {
                                        const startMinutes =
                                            getMinutesFromTime(
                                                appointment.start_time,
                                            ) -
                                            7 * 60;
                                        const top = Math.max(
                                            0,
                                            (startMinutes / 60) * 76,
                                        );
                                        const height = Math.max(
                                            54,
                                            (appointment.duration_minutes / 60) *
                                            76 -
                                            7,
                                        );
                                        const appointmentEndDate = new Date(
                                            `${appointment.appointment_date}T${String(
                                                appointment.start_time,
                                            ).slice(0, 5)}:00`,
                                        );
                                        appointmentEndDate.setMinutes(
                                            appointmentEndDate.getMinutes() +
                                            appointment.duration_minutes,
                                        );
                                        const isPastAppointment =
                                            appointment.status !== "cancelled" &&
                                            appointmentEndDate.getTime() <
                                            Date.now();
                                        const isNextAppointment =
                                            appointment.status !== "cancelled" &&
                                            appointment.id === nextAppointment?.id;

                                        const whatsappNumber =
                                            normalizePhoneForWhatsApp(
                                                appointment.client_phone,
                                            );
                                        const whatsappMessage =
                                            encodeURIComponent(
                                                `Olá, ${appointment.client_name}! Estou entrando em contato sobre seu agendamento de ${appointment.service_name}, no dia ${formatAdminDate(appointment.appointment_date)}, às ${String(appointment.start_time).slice(0, 5)}.`,
                                            );

                                        return (
                                            <article
                                                key={appointment.id}
                                                className={`admin-agenda__appointment ${
                                                    appointment.status ===
                                                    "cancelled"
                                                        ? "is-cancelled"
                                                        : isPastAppointment
                                                            ? "is-past"
                                                            : isNextAppointment
                                                                ? "is-next"
                                                                : ""
                                                }`}
                                                style={{
                                                    top: `${top}px`,
                                                    height: `${height}px`,
                                                }}
                                            >
                                                <strong>
                                                    {String(
                                                        appointment.start_time,
                                                    ).slice(0, 5)}{" "}
                                                    — {appointment.client_name}
                                                </strong>
                                                <span>
                                            {appointment.service_name} •{" "}
                                                    {
                                                        appointment.duration_minutes
                                                    }{" "}
                                                    min
                                        </span>
                                                <span>
                                            {appointment.client_phone}
                                        </span>

                                                <div className="admin-agenda__appointment-actions">
                                                    <button
                                                        className="admin-details-button"
                                                        type="button"
                                                        onClick={() =>
                                                            openAppointmentDetails(
                                                                appointment,
                                                            )
                                                        }
                                                    >
                                                        Detalhes
                                                    </button>
                                                    {appointment.status !==
                                                        "cancelled" && (
                                                            <button
                                                                type="button"
                                                                disabled={
                                                                    updatingId ===
                                                                    appointment.id
                                                                }
                                                                onClick={() =>
                                                                    updateAppointmentStatus(
                                                                        appointment.id,
                                                                        "cancelled",
                                                                    )
                                                                }
                                                            >
                                                                Cancelar
                                                            </button>
                                                        )}
                                                    <a
                                                        href={`https://wa.me/${whatsappNumber}?text=${whatsappMessage}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                    >
                                                        WhatsApp
                                                    </a>
                                                </div>
                                            </article>
                                        );
                                    })}
                                </div>
                            </div>
                        ) : adminView === "week" ? (
                            <div className="admin-week">
                                <div className="admin-week__grid">
                                    {weekDates.map((date) => {
                                        const dayAppointments = appointments
                                            .filter((appointment) => {
                                                const matchesDate =
                                                    appointment.appointment_date ===
                                                    date;
                                                const matchesStatus =
                                                    statusFilter === "all" ||
                                                    (statusFilter === "active" &&
                                                        appointment.status !==
                                                        "cancelled") ||
                                                    appointment.status ===
                                                    statusFilter;
                                                const normalizedSearch =
                                                    search.trim().toLowerCase();
                                                const matchesSearch =
                                                    !normalizedSearch ||
                                                    appointment.client_name
                                                        .toLowerCase()
                                                        .includes(normalizedSearch) ||
                                                    appointment.client_phone
                                                        .toLowerCase()
                                                        .includes(normalizedSearch) ||
                                                    appointment.service_name
                                                        .toLowerCase()
                                                        .includes(normalizedSearch);

                                                return (
                                                    matchesDate &&
                                                    matchesStatus &&
                                                    matchesSearch
                                                );
                                            })
                                            .sort(
                                                (first, second) =>
                                                    getMinutesFromTime(
                                                        first.start_time,
                                                    ) -
                                                    getMinutesFromTime(
                                                        second.start_time,
                                                    ),
                                            );

                                        const dayBlocks = adminBlocks
                                            .filter(
                                                (block) =>
                                                    block.block_date === date,
                                            )
                                            .sort(
                                                (first, second) =>
                                                    getMinutesFromTime(
                                                        first.start_time,
                                                    ) -
                                                    getMinutesFromTime(
                                                        second.start_time,
                                                    ),
                                            );

                                        const today =
                                            date ===
                                            formatDateForInput(new Date());

                                        return (
                                            <section
                                                className={`admin-week__day ${
                                                    today ? "is-today" : ""
                                                }`}
                                                key={date}
                                            >
                                                <header className="admin-week__day-header">
                                            <span>
                                                {new Intl.DateTimeFormat(
                                                    "pt-BR",
                                                    {
                                                        weekday: "long",
                                                    },
                                                ).format(
                                                    new Date(
                                                        `${date}T12:00:00`,
                                                    ),
                                                )}
                                            </span>
                                                    <strong>
                                                        {formatAdminDate(date)}
                                                    </strong>
                                                </header>

                                                <div className="admin-week__content">
                                                    {dayBlocks.map((block) => (
                                                        <article
                                                            className="admin-week__block"
                                                            key={block.id}
                                                        >
                                                            <strong>
                                                                {String(
                                                                    block.start_time,
                                                                ).slice(0, 5)}{" "}
                                                                –{" "}
                                                                {String(
                                                                    block.end_time,
                                                                ).slice(0, 5)}
                                                            </strong>
                                                            <span>
                                                        {block.reason ||
                                                            "Horário bloqueado"}
                                                    </span>
                                                        </article>
                                                    ))}

                                                    {dayAppointments.map(
                                                        (appointment) => {
                                                            const whatsappNumber =
                                                                normalizePhoneForWhatsApp(
                                                                    appointment.client_phone,
                                                                );
                                                            const whatsappMessage =
                                                                encodeURIComponent(
                                                                    `Olá, ${appointment.client_name}! Estou entrando em contato sobre seu agendamento de ${appointment.service_name}, no dia ${formatAdminDate(appointment.appointment_date)}, às ${String(appointment.start_time).slice(0, 5)}.`,
                                                                );

                                                            return (
                                                                <article
                                                                    className={`admin-week__appointment ${
                                                                        appointment.status ===
                                                                        "cancelled"
                                                                            ? "is-cancelled"
                                                                            : ""
                                                                    }`}
                                                                    key={
                                                                        appointment.id
                                                                    }
                                                                >
                                                                    <strong>
                                                                        {String(
                                                                            appointment.start_time,
                                                                        ).slice(
                                                                            0,
                                                                            5,
                                                                        )}{" "}
                                                                        —{" "}
                                                                        {
                                                                            appointment.client_name
                                                                        }
                                                                    </strong>
                                                                    <span>
                                                                {
                                                                    appointment.service_name
                                                                }{" "}
                                                                        •{" "}
                                                                        {
                                                                            appointment.duration_minutes
                                                                        }{" "}
                                                                        min
                                                            </span>
                                                                    <span>
                                                                {
                                                                    appointment.client_phone
                                                                }
                                                            </span>

                                                                    <div className="admin-week__actions">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() =>
                                                                                openAppointmentDetails(
                                                                                    appointment,
                                                                                )
                                                                            }
                                                                        >
                                                                            Detalhes
                                                                        </button>
                                                                        {appointment.status !==
                                                                            "cancelled" && (
                                                                                <button
                                                                                    type="button"
                                                                                    disabled={
                                                                                        updatingId ===
                                                                                        appointment.id
                                                                                    }
                                                                                    onClick={() =>
                                                                                        updateAppointmentStatus(
                                                                                            appointment.id,
                                                                                            "cancelled",
                                                                                        )
                                                                                    }
                                                                                >
                                                                                    Cancelar
                                                                                </button>
                                                                            )}
                                                                        <a
                                                                            href={`https://wa.me/${whatsappNumber}?text=${whatsappMessage}`}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                        >
                                                                            WhatsApp
                                                                        </a>
                                                                    </div>
                                                                </article>
                                                            );
                                                        },
                                                    )}

                                                    {dayAppointments.length === 0 &&
                                                        dayBlocks.length === 0 && (
                                                            <div className="admin-week__empty">
                                                                Dia livre
                                                            </div>
                                                        )}
                                                </div>
                                            </section>
                                        );
                                    })}
                                </div>
                            </div>
                        ) : filteredAppointments.length === 0 ? (
                            <div className="admin-empty">
                                Nenhum agendamento encontrado.
                            </div>
                        ) : (
                            <div className="admin-list">
                                {filteredAppointments.map((appointment) => {
                                    const whatsappNumber =
                                        normalizePhoneForWhatsApp(
                                            appointment.client_phone,
                                        );
                                    const whatsappMessage = encodeURIComponent(
                                        `Olá, ${appointment.client_name}! Estou entrando em contato sobre seu agendamento de ${appointment.service_name}, no dia ${formatAdminDate(appointment.appointment_date)}, às ${String(appointment.start_time).slice(0, 5)}.`,
                                    );

                                    return (
                                        <article
                                            className="admin-appointment"
                                            key={appointment.id}
                                        >
                                            <div className="admin-appointment__top">
                                                <div>
                                            <span className="admin-appointment__time">
                                                {formatAdminDate(
                                                    appointment.appointment_date,
                                                )}{" "}
                                                •{" "}
                                                {String(
                                                    appointment.start_time,
                                                ).slice(0, 5)}
                                            </span>
                                                    <h2>
                                                        {appointment.client_name}
                                                    </h2>
                                                </div>

                                                <span
                                                    className={`admin-status admin-status--${appointment.status}`}
                                                >
                                            {appointment.status ===
                                            "pending"
                                                ? "Pendente antigo"
                                                : appointment.status ===
                                                "confirmed"
                                                    ? "Confirmado"
                                                    : "Cancelado"}
                                        </span>
                                            </div>

                                            <div className="admin-appointment__details">
                                                <div className="admin-detail">
                                                    <span>Serviço</span>
                                                    <strong>
                                                        {
                                                            appointment.service_name
                                                        }
                                                    </strong>
                                                </div>
                                                <div className="admin-detail">
                                                    <span>Duração</span>
                                                    <strong>
                                                        {
                                                            appointment.duration_minutes
                                                        }{" "}
                                                        min
                                                    </strong>
                                                </div>
                                                <div className="admin-detail">
                                                    <span>Telefone</span>
                                                    <a
                                                        href={`tel:${appointment.client_phone}`}
                                                    >
                                                        {
                                                            appointment.client_phone
                                                        }
                                                    </a>
                                                </div>
                                                <div className="admin-detail">
                                                    <span>E-mail</span>
                                                    <strong>
                                                        {appointment.client_email ||
                                                            "Não informado"}
                                                    </strong>
                                                </div>
                                            </div>

                                            <div className="admin-appointment__actions">
                                                <button
                                                    className="admin-details-button"
                                                    type="button"
                                                    onClick={() =>
                                                        openAppointmentDetails(
                                                            appointment,
                                                        )
                                                    }
                                                >
                                                    Ver detalhes
                                                </button>
                                                {appointment.status !==
                                                    "cancelled" && (
                                                        <button
                                                            className="admin-action admin-action--cancel"
                                                            type="button"
                                                            disabled={
                                                                updatingId ===
                                                                appointment.id
                                                            }
                                                            onClick={() =>
                                                                updateAppointmentStatus(
                                                                    appointment.id,
                                                                    "cancelled",
                                                                )
                                                            }
                                                        >
                                                            Cancelar
                                                        </button>
                                                    )}

                                                <a
                                                    className="admin-action--whatsapp"
                                                    href={`https://wa.me/${whatsappNumber}?text=${whatsappMessage}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                >
                                                    Abrir WhatsApp
                                                </a>
                                            </div>
                                        </article>
                                    );
                                })}
                            </div>
                        )}

                    </>
                )}

                {selectedClient && (
                    <div
                        className="admin-modal-backdrop"
                        role="dialog"
                        aria-modal="true"
                        aria-label={`Histórico de ${selectedClient.name}`}
                        onMouseDown={(event) => {
                            if (event.target === event.currentTarget) {
                                setSelectedClient(null);
                            }
                        }}
                    >
                        <section className="admin-client-history">
                            <button
                                className="admin-modal__close"
                                type="button"
                                aria-label="Fechar histórico"
                                onClick={() => setSelectedClient(null)}
                            >
                                ×
                            </button>
                            <span className="admin-clients__eyebrow">
                            Histórico da cliente
                        </span>
                            <h2>{selectedClient.name}</h2>
                            <p>
                                {selectedClient.phone}
                                {selectedClient.email
                                    ? ` • ${selectedClient.email}`
                                    : ""}
                            </p>

                            <div className="admin-client-history__list">
                                {selectedClient.appointments.map((appointment) => (
                                    <article key={appointment.id}>
                                        <div>
                                            <strong>
                                                {formatAdminDate(
                                                    appointment.appointment_date,
                                                )}{" "}
                                                às{" "}
                                                {String(
                                                    appointment.start_time,
                                                ).slice(0, 5)}
                                            </strong>
                                            <span>{appointment.service_name}</span>
                                        </div>
                                        <span
                                            className={`admin-status admin-status--${appointment.status}`}
                                        >
                                        {appointment.status === "confirmed"
                                            ? "Confirmado"
                                            : appointment.status === "cancelled"
                                                ? "Cancelado"
                                                : "Pendente"}
                                    </span>
                                    </article>
                                ))}
                            </div>
                        </section>
                    </div>
                )}

                {editingClient && (
                    <div
                        className="admin-modal-backdrop"
                        role="dialog"
                        aria-modal="true"
                        aria-label={`Editar ${editingClient.name}`}
                    >
                        <form
                            className="admin-client-editor"
                            onSubmit={saveClientChanges}
                        >
                            <button
                                className="admin-modal__close"
                                type="button"
                                aria-label="Fechar edição"
                                onClick={closeClientEditor}
                            >
                                ×
                            </button>
                            <span className="admin-clients__eyebrow">
                            Cadastro da cliente
                        </span>
                            <h2>Editar informações</h2>

                            <label>
                                Nome completo
                                <input
                                    type="text"
                                    value={editClientName}
                                    onChange={(event) =>
                                        setEditClientName(event.target.value)
                                    }
                                    required
                                />
                            </label>

                            <label>
                                Telefone
                                <input
                                    type="tel"
                                    inputMode="numeric"
                                    maxLength={15}
                                    value={editClientPhone}
                                    onChange={(event) =>
                                        setEditClientPhone(
                                            formatBrazilianPhone(
                                                event.target.value,
                                            ),
                                        )
                                    }
                                    required
                                />
                            </label>

                            <label>
                                E-mail
                                <input
                                    type="email"
                                    value={editClientEmail}
                                    onChange={(event) =>
                                        setEditClientEmail(event.target.value)
                                    }
                                    placeholder="Opcional"
                                />
                            </label>

                            {clientEditError && (
                                <p className="admin-reschedule__message">
                                    {clientEditError}
                                </p>
                            )}

                            <button
                                className="admin-primary-button"
                                type="submit"
                                disabled={isSavingClient}
                            >
                                {isSavingClient
                                    ? "Salvando..."
                                    : "Salvar alterações"}
                            </button>
                        </form>
                    </div>
                )}

                {selectedAdminAppointment && (
                    <div
                        className="admin-modal-backdrop"
                        role="presentation"
                        onMouseDown={(event) => {
                            if (event.target === event.currentTarget) {
                                closeAppointmentDetails();
                            }
                        }}
                    >
                        <section
                            className="admin-modal"
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="admin-modal-title"
                        >
                            <header className="admin-modal__header">
                                <div>
                                    <h2 id="admin-modal-title">
                                        {selectedAdminAppointment.client_name}
                                    </h2>
                                    <p>
                                        Detalhes e reagendamento da cliente
                                    </p>
                                </div>
                                <button
                                    className="admin-modal__close"
                                    type="button"
                                    aria-label="Fechar"
                                    onClick={closeAppointmentDetails}
                                >
                                    ×
                                </button>
                            </header>

                            <div className="admin-modal__body">
                                <div className="admin-modal__grid">
                                    <div className="admin-modal__item">
                                        <span>Serviço</span>
                                        <strong>
                                            {
                                                selectedAdminAppointment.service_name
                                            }
                                        </strong>
                                    </div>
                                    <div className="admin-modal__item">
                                        <span>Duração</span>
                                        <strong>
                                            {
                                                selectedAdminAppointment.duration_minutes
                                            }{" "}
                                            minutos
                                        </strong>
                                    </div>
                                    <div className="admin-modal__item">
                                        <span>Telefone</span>
                                        <a
                                            href={`tel:${selectedAdminAppointment.client_phone}`}
                                        >
                                            {
                                                selectedAdminAppointment.client_phone
                                            }
                                        </a>
                                    </div>
                                    <div className="admin-modal__item">
                                        <span>E-mail</span>
                                        <strong>
                                            {selectedAdminAppointment.client_email ||
                                                "Não informado"}
                                        </strong>
                                    </div>
                                    <div className="admin-modal__item">
                                        <span>Data atual</span>
                                        <strong>
                                            {formatAdminDate(
                                                selectedAdminAppointment.appointment_date,
                                            )}
                                        </strong>
                                    </div>
                                    <div className="admin-modal__item">
                                        <span>Horário atual</span>
                                        <strong>
                                            {String(
                                                selectedAdminAppointment.start_time,
                                            ).slice(0, 5)}
                                        </strong>
                                    </div>
                                </div>

                                {selectedAdminAppointment.status !==
                                    "cancelled" && (
                                        <div className="admin-reschedule">
                                            <h3>Reagendar</h3>
                                            <p>
                                                Escolha uma nova data e horário. O
                                                sistema impede conflito com outros
                                                agendamentos.
                                            </p>

                                            <div className="admin-reschedule__fields">
                                                <label>
                                                    Nova data
                                                    <input
                                                        type="date"
                                                        min={formatDateForInput(
                                                            new Date(),
                                                        )}
                                                        value={rescheduleDate}
                                                        onChange={(event) =>
                                                            setRescheduleDate(
                                                                event.target.value,
                                                            )
                                                        }
                                                    />
                                                </label>

                                                <label>
                                                    Novo horário
                                                    <select
                                                        value={rescheduleTime}
                                                        onChange={(event) =>
                                                            setRescheduleTime(
                                                                event.target.value,
                                                            )
                                                        }
                                                    >
                                                        {Array.from(
                                                            {length: 25},
                                                            (_, index) => {
                                                                const totalMinutes =
                                                                    7 * 60 +
                                                                    index * 30;
                                                                const hours =
                                                                    Math.floor(
                                                                        totalMinutes /
                                                                        60,
                                                                    );
                                                                const minutes =
                                                                    totalMinutes % 60;
                                                                const value = `${String(
                                                                    hours,
                                                                ).padStart(
                                                                    2,
                                                                    "0",
                                                                )}:${String(
                                                                    minutes,
                                                                ).padStart(2, "0")}`;

                                                                return (
                                                                    <option
                                                                        key={value}
                                                                        value={value}
                                                                    >
                                                                        {value}
                                                                    </option>
                                                                );
                                                            },
                                                        )}
                                                    </select>
                                                </label>
                                            </div>

                                            {rescheduleError && (
                                                <p className="admin-reschedule__message">
                                                    {rescheduleError}
                                                </p>
                                            )}

                                            <div className="admin-reschedule__actions">
                                                <button
                                                    className="admin-reschedule__save"
                                                    type="button"
                                                    disabled={isRescheduling}
                                                    onClick={handleReschedule}
                                                >
                                                    {isRescheduling
                                                        ? "Salvando..."
                                                        : "Salvar reagendamento"}
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                <a
                                    className="admin-modal__whatsapp"
                                    href={`https://wa.me/${normalizePhoneForWhatsApp(
                                        selectedAdminAppointment.client_phone,
                                    )}?text=${encodeURIComponent(
                                        `Olá, ${selectedAdminAppointment.client_name}! Estou entrando em contato sobre seu agendamento de ${selectedAdminAppointment.service_name}, no dia ${formatAdminDate(selectedAdminAppointment.appointment_date)}, às ${String(selectedAdminAppointment.start_time).slice(0, 5)}.`,
                                    )}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    Conversar pelo WhatsApp
                                </a>
                            </div>
                        </section>
                    </div>
                )}
            </section>
        </main>
    );
}

function App() {
    const normalizedPath = window.location.pathname.replace(/\/+$/, "");

    if (normalizedPath === "/admin") {
        return <AdminPanel/>;
    }

    return <PublicSite/>;
}

export default App;
