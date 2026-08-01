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
                            <div><strong>Escolha a data</strong><p>Selecione qualquer data futura.</p>
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
                        clientes podem escolher qualquer data futura.</p>
                        <input className="booking-modal__date" type="date" min={today}
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

    return `55${digits}`;
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


const adminEnhancementStyles = `
.admin-dashboard-cards {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 18px;
}
.admin-dashboard-card {
    border: 1px solid #e5d2d8;
    border-radius: 17px;
    padding: 18px;
    background: #fff;
    color: #6d3445;
    text-align: left;
    cursor: pointer;
    box-shadow: 0 9px 26px rgba(83, 48, 58, 0.06);
}
.admin-dashboard-card strong,
.admin-dashboard-card span {
    display: block;
}
.admin-dashboard-card strong {
    font-size: 1rem;
    margin-bottom: 5px;
}
.admin-dashboard-card span {
    color: #80666e;
    font-size: .82rem;
}
.admin-dashboard-card.is-active {
    color: #fff;
    border-color: transparent;
    background: linear-gradient(135deg, #6d3445, #a86175);
}
.admin-dashboard-card.is-active span { color: rgba(255,255,255,.82); }

.admin-content-section {
    display: grid;
    gap: 16px;
}
.admin-section-heading {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: flex-end;
    padding: 18px 20px;
    border: 1px solid #eadde1;
    border-radius: 18px;
    background: #fff;
}
.admin-section-heading h2 { margin: 0 0 5px; }
.admin-section-heading p { margin: 0; color: #80666e; }
.admin-section-date-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
}
.admin-section-date-controls button {
    border: 1px solid #d7c0c7;
    border-radius: 10px;
    padding: 10px 13px;
    background: #fff;
    color: #6d3445;
    font: inherit;
    font-weight: 800;
    cursor: pointer;
}
.admin-section-date-controls input {
    border: 1px solid #d7c0c7;
    border-radius: 10px;
    padding: 10px 12px;
    font: inherit;
}

.admin-card-list {
    display: grid;
    gap: 13px;
}
.admin-day-group {
    display: grid;
    gap: 11px;
}
.admin-day-group__title {
    margin: 8px 0 0;
    padding: 11px 14px;
    border-radius: 12px;
    background: #efe3e7;
    color: #5e3542;
    text-transform: capitalize;
}
.admin-booking-card {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #e0c7cf;
    border-left: 6px solid #8b485d;
    border-radius: 17px;
    padding: 17px 18px;
    background: linear-gradient(135deg, #fff, #fbf4f6);
    box-shadow: 0 9px 26px rgba(83, 48, 58, 0.07);
    text-align: left;
    cursor: pointer;
}
.admin-booking-card:hover {
    transform: translateY(-1px);
    box-shadow: 0 13px 32px rgba(83, 48, 58, 0.1);
}
.admin-booking-card.is-cancelled {
    opacity: .68;
    border-left-color: #aaa0a4;
}
.admin-booking-card__top {
    display: flex;
    justify-content: space-between;
    gap: 14px;
    align-items: flex-start;
}
.admin-booking-card__time {
    color: #8b485d;
    font-size: 1.08rem;
    font-weight: 900;
}
.admin-booking-card h3 {
    margin: 5px 0 0;
    color: #302126;
}
.admin-booking-card__details {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
    margin-top: 14px;
}
.admin-booking-card__details div {
    padding: 10px 11px;
    border-radius: 11px;
    background: #f7ecef;
}
.admin-booking-card__details span,
.admin-booking-card__details strong {
    display: block;
}
.admin-booking-card__details span {
    color: #80666e;
    font-size: .7rem;
    font-weight: 800;
    text-transform: uppercase;
}
.admin-booking-card__details strong {
    margin-top: 4px;
    color: #4d363e;
    font-size: .84rem;
    overflow-wrap: anywhere;
}
.admin-booking-card__footer {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 13px;
}
.admin-booking-card__footer a,
.admin-booking-card__footer button {
    border: 0;
    border-radius: 9px;
    padding: 9px 11px;
    color: #fff;
    font: inherit;
    font-size: .78rem;
    font-weight: 800;
    text-decoration: none;
    cursor: pointer;
}
.admin-booking-card__footer button { background: #6d3445; }
.admin-booking-card__footer a { background: #1f9d59; }

.admin-edit-form {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 13px;
}
.admin-edit-form label {
    display: grid;
    gap: 7px;
    font-size: .84rem;
    font-weight: 800;
}
.admin-edit-form input,
.admin-edit-form select {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #d8c7cc;
    border-radius: 11px;
    padding: 11px 12px;
    font: inherit;
}
.admin-edit-form__full { grid-column: 1 / -1; }
.admin-edit-actions {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    gap: 9px;
    margin-top: 5px;
}
.admin-edit-actions button {
    border: 0;
    border-radius: 10px;
    padding: 11px 14px;
    color: #fff;
    font: inherit;
    font-weight: 800;
    cursor: pointer;
}
.admin-edit-actions .save { background: #6d3445; }
.admin-edit-actions .cancel { background: #a23f4d; }
.admin-edit-actions .delete { background: #3e272d; }
.admin-edit-actions .close { background: #8a7078; }

.admin-client-card__actions .is-danger {
    background: #a23f4d;
    color: #fff;
}
.admin-client-card__metrics {
    grid-template-columns: 1fr 1fr;
}

.admin-block-manager--bottom {
    margin-top: 22px;
    margin-bottom: 0;
}
.admin-block-date-row {
    display: grid;
    grid-template-columns: minmax(180px, 260px) minmax(220px, 1fr);
    gap: 13px;
    align-items: end;
}
.admin-block-date-row label {
    display: grid;
    gap: 7px;
    font-weight: 800;
    font-size: .84rem;
}
.admin-block-date-row input {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #d8c7cc;
    border-radius: 11px;
    padding: 11px 12px;
    font: inherit;
}
.admin-block-times {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(86px, 1fr));
    gap: 9px;
    margin-top: 15px;
}
.admin-block-time {
    border: 1px solid #d9c1c8;
    border-radius: 11px;
    padding: 11px 8px;
    background: #fff;
    color: #6d3445;
    font: inherit;
    font-weight: 850;
    cursor: pointer;
}
.admin-block-time.is-selected {
    background: #6d3445;
    color: #fff;
    border-color: #6d3445;
}
.admin-block-submit-row {
    display: grid;
    grid-template-columns: minmax(220px, 1fr) auto;
    gap: 10px;
    margin-top: 14px;
}
.admin-block-submit-row input {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #d8c7cc;
    border-radius: 11px;
    padding: 11px 12px;
    font: inherit;
}
.admin-block-submit-row button {
    border: 0;
    border-radius: 11px;
    padding: 11px 16px;
    background: #6d3445;
    color: #fff;
    font: inherit;
    font-weight: 850;
    cursor: pointer;
}
.admin-block-submit-row button:disabled { opacity: .55; cursor: wait; }


.admin-top-agenda {
    display: grid;
    gap: 13px;
    margin-bottom: 18px;
}
.admin-top-agenda__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    padding: 16px 18px;
    border: 1px solid rgba(154, 83, 104, 0.2);
    border-radius: 18px;
    background: #fff;
}
.admin-top-agenda__header span,
.admin-top-agenda__header strong { display: block; }
.admin-top-agenda__header span {
    margin-bottom: 5px;
    color: #8a7078;
    font-size: .78rem;
    font-weight: 800;
    text-transform: uppercase;
}
.admin-top-agenda__header strong {
    color: #4d3039;
    text-transform: capitalize;
}
.admin-top-agenda .admin-booking-card {
    border: 1px solid rgba(255,255,255,.14);
    border-left: 0;
    background: linear-gradient(135deg, #71364a, #a66075);
    color: #fff;
    box-shadow: 0 14px 34px rgba(83, 48, 58, 0.16);
}
.admin-top-agenda .admin-booking-card:hover {
    box-shadow: 0 18px 40px rgba(83, 48, 58, 0.22);
}
.admin-top-agenda .admin-booking-card h3,
.admin-top-agenda .admin-booking-card__time,
.admin-top-agenda .admin-booking-card__details strong { color: #fff; }
.admin-top-agenda .admin-booking-card__details div {
    background: rgba(255,255,255,.11);
}
.admin-top-agenda .admin-booking-card__details span {
    color: rgba(255,255,255,.74);
}
.admin-top-agenda .admin-booking-card.is-cancelled {
    background: linear-gradient(135deg, #777073, #9a8f93);
}
.admin-empty--top {
    border: 1px dashed #d9bec7;
    background: rgba(255,255,255,.9);
}

@media (max-width: 850px) {
    .admin-dashboard-cards { grid-template-columns: 1fr 1fr; }
    .admin-booking-card__details { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 620px) {
    .admin-dashboard-cards,
    .admin-booking-card__details,
    .admin-edit-form,
    .admin-block-date-row,
    .admin-block-submit-row {
        grid-template-columns: 1fr;
    }
    .admin-edit-form__full,
    .admin-edit-actions { grid-column: auto; }
    .admin-section-heading,
    .admin-top-agenda__header,
    .admin-booking-card__top { flex-direction: column; align-items: stretch; }
}
`;


function AdminPanel() {
    const [isCheckingSession, setIsCheckingSession] = useState(true);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loginError, setLoginError] = useState("");
    const [isLoggingIn, setIsLoggingIn] = useState(false);

    const [appointments, setAppointments] = useState<AdminAppointment[]>([]);
    const [adminBlocks, setAdminBlocks] = useState<AdminScheduleBlock[]>([]);
    const [adminServices, setAdminServices] = useState<AdminServiceSetting[]>([]);
    const [adminBusinessHours, setAdminBusinessHours] = useState<AdminBusinessHour[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [panelError, setPanelError] = useState("");

    const [adminView, setAdminView] = useState<"agenda" | "week" | "clients" | "settings">("agenda");
    const [agendaDate, setAgendaDate] = useState(formatDateForInput(new Date()));

    const [showManualForm, setShowManualForm] = useState(false);
    const [manualClientName, setManualClientName] = useState("");
    const [manualClientPhone, setManualClientPhone] = useState("");
    const [manualClientEmail, setManualClientEmail] = useState("");
    const [manualServiceName, setManualServiceName] = useState(fallbackServices[0].name);
    const [manualDate, setManualDate] = useState(formatDateForInput(new Date()));
    const [manualTime, setManualTime] = useState("07:00");
    const [manualError, setManualError] = useState("");
    const [manualSuccess, setManualSuccess] = useState("");
    const [isSavingManualAppointment, setIsSavingManualAppointment] = useState(false);

    const [selectedAdminAppointment, setSelectedAdminAppointment] = useState<AdminAppointment | null>(null);
    const [editAppointmentName, setEditAppointmentName] = useState("");
    const [editAppointmentPhone, setEditAppointmentPhone] = useState("");
    const [editAppointmentEmail, setEditAppointmentEmail] = useState("");
    const [editAppointmentService, setEditAppointmentService] = useState("");
    const [editAppointmentDate, setEditAppointmentDate] = useState("");
    const [editAppointmentTime, setEditAppointmentTime] = useState("");
    const [appointmentEditError, setAppointmentEditError] = useState("");
    const [isSavingAppointment, setIsSavingAppointment] = useState(false);

    const [clientSearch, setClientSearch] = useState("");
    const [selectedClient, setSelectedClient] = useState<AdminClient | null>(null);
    const [editingClient, setEditingClient] = useState<AdminClient | null>(null);
    const [editClientName, setEditClientName] = useState("");
    const [editClientPhone, setEditClientPhone] = useState("");
    const [editClientEmail, setEditClientEmail] = useState("");
    const [clientEditError, setClientEditError] = useState("");
    const [isSavingClient, setIsSavingClient] = useState(false);
    const [deletingClientKey, setDeletingClientKey] = useState("");

    const [blockDate, setBlockDate] = useState(formatDateForInput(new Date()));
    const [selectedBlockTimes, setSelectedBlockTimes] = useState<string[]>([]);
    const [blockReason, setBlockReason] = useState("");
    const [blockError, setBlockError] = useState("");
    const [isSavingBlock, setIsSavingBlock] = useState(false);

    const [settingsError, setSettingsError] = useState("");
    const [settingsSuccess, setSettingsSuccess] = useState("");
    const [savingServiceId, setSavingServiceId] = useState<number | null>(null);
    const [savingHoursId, setSavingHoursId] = useState<number | null>(null);

    const allDayTimes = useMemo(
        () => Array.from({length: 48}, (_, index) => minutesToTime(index * 30)),
        [],
    );

    useEffect(() => {
        async function checkSession() {
            const {data: {session}} = await supabase.auth.getSession();
            setIsAuthenticated(Boolean(session));
            setIsCheckingSession(false);
        }
        void checkSession();
        const {data: {subscription}} = supabase.auth.onAuthStateChange((_event, session) => {
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

        async function loadAdminData() {
            setIsLoading(true);
            setPanelError("");
            const [
                {data: appointmentData, error: appointmentError},
                {data: blockData, error: blockLoadError},
                {data: serviceData, error: serviceLoadError},
                {data: hoursData, error: hoursLoadError},
            ] = await Promise.all([
                supabase.from("appointments")
                    .select("id, client_name, client_phone, client_email, service_name, appointment_date, start_time, duration_minutes, status, created_at")
                    .order("appointment_date", {ascending: true})
                    .order("start_time", {ascending: true}),
                supabase.from("schedule_blocks")
                    .select("id, block_date, start_time, end_time, reason, created_at")
                    .order("block_date", {ascending: true})
                    .order("start_time", {ascending: true}),
                supabase.from("services")
                    .select("id, name, description, duration_minutes, price_cents, display_order")
                    .order("display_order", {ascending: true}),
                supabase.from("business_hours")
                    .select("id, day_of_week, start_time, end_time")
                    .order("day_of_week", {ascending: true}),
            ]);

            if (appointmentError || blockLoadError || serviceLoadError || hoursLoadError) {
                console.error("Erro ao carregar painel:", appointmentError || blockLoadError || serviceLoadError || hoursLoadError);
                setPanelError("Não foi possível carregar os dados do painel. Atualize a página.");
                setIsLoading(false);
                return;
            }

            setAppointments((appointmentData ?? []) as AdminAppointment[]);
            setAdminBlocks((blockData ?? []) as AdminScheduleBlock[]);
            setAdminServices((serviceData ?? []) as AdminServiceSetting[]);
            setAdminBusinessHours(((hoursData ?? []) as AdminBusinessHour[]).map((hours) => ({
                ...hours,
                start_time: String(hours.start_time).slice(0, 5),
                end_time: String(hours.end_time).slice(0, 5),
            })));
            if (serviceData?.length) setManualServiceName(serviceData[0].name);
            setIsLoading(false);
        }

        void loadAdminData();
        const appointmentsChannel = supabase.channel("admin-appointments-updates")
            .on("postgres_changes", {event: "*", schema: "public", table: "appointments"}, () => void loadAdminData())
            .subscribe();
        const blocksChannel = supabase.channel("admin-schedule-blocks-updates")
            .on("postgres_changes", {event: "*", schema: "public", table: "schedule_blocks"}, () => void loadAdminData())
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
        const {error} = await supabase.auth.signInWithPassword({email: email.trim(), password});
        if (error) {
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

    function appointmentConflicts(
        appointmentId: string,
        date: string,
        time: string,
        durationMinutes: number,
    ) {
        const start = getMinutesFromTime(time);
        const end = start + durationMinutes;
        const conflictsAppointment = appointments.some((appointment) => {
            if (appointment.id === appointmentId || appointment.status === "cancelled" || appointment.appointment_date !== date) return false;
            const existingStart = getMinutesFromTime(appointment.start_time);
            return intervalsOverlap(start, end, existingStart, existingStart + appointment.duration_minutes);
        });
        const conflictsBlock = adminBlocks.some((block) =>
            block.block_date === date &&
            intervalsOverlap(start, end, getMinutesFromTime(block.start_time), getMinutesFromTime(block.end_time)),
        );
        return conflictsAppointment || conflictsBlock;
    }

    async function createManualAppointment(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setManualError("");
        setManualSuccess("");

        const service = adminServices.find((item) => item.name === manualServiceName);
        if (!service) {
            setManualError("Escolha um serviço válido.");
            return;
        }
        if (manualClientName.trim().length < 3 || manualClientPhone.replace(/\D/g, "").length < 10) {
            setManualError("Informe nome completo e telefone válido.");
            return;
        }
        if (!manualDate || !manualTime) {
            setManualError("Escolha a data e o horário.");
            return;
        }
        if (appointmentConflicts("", manualDate, manualTime, service.duration_minutes)) {
            setManualError("Este período entra em conflito com outro agendamento ou bloqueio.");
            return;
        }

        setIsSavingManualAppointment(true);
        const {data, error} = await supabase.from("appointments").insert({
            client_name: manualClientName.trim(),
            client_phone: formatBrazilianPhone(manualClientPhone),
            client_email: manualClientEmail.trim() || null,
            service_name: service.name,
            appointment_date: manualDate,
            start_time: manualTime,
            duration_minutes: service.duration_minutes,
            status: "confirmed",
        }).select("id, client_name, client_phone, client_email, service_name, appointment_date, start_time, duration_minutes, status, created_at").single();

        if (error || !data) {
            console.error("Erro ao criar agendamento:", error);
            setManualError("Não foi possível criar o agendamento.");
            setIsSavingManualAppointment(false);
            return;
        }

        setAppointments((current) => [...current, data as AdminAppointment]);
        setManualSuccess("Agendamento criado com sucesso.");
        setAgendaDate(manualDate);
        setManualClientName("");
        setManualClientPhone("");
        setManualClientEmail("");
        setIsSavingManualAppointment(false);
    }

    function openAppointmentDetails(appointment: AdminAppointment) {
        setSelectedAdminAppointment(appointment);
        setEditAppointmentName(appointment.client_name);
        setEditAppointmentPhone(appointment.client_phone);
        setEditAppointmentEmail(appointment.client_email ?? "");
        setEditAppointmentService(appointment.service_name);
        setEditAppointmentDate(appointment.appointment_date);
        setEditAppointmentTime(String(appointment.start_time).slice(0, 5));
        setAppointmentEditError("");
    }

    async function saveAppointmentChanges() {
        if (!selectedAdminAppointment) return;
        const service = adminServices.find((item) => item.name === editAppointmentService);
        if (!service) {
            setAppointmentEditError("Escolha um serviço válido.");
            return;
        }
        if (editAppointmentName.trim().length < 3 || editAppointmentPhone.replace(/\D/g, "").length < 10) {
            setAppointmentEditError("Informe nome completo e telefone válido.");
            return;
        }
        if (appointmentConflicts(selectedAdminAppointment.id, editAppointmentDate, editAppointmentTime, service.duration_minutes)) {
            setAppointmentEditError("O novo período entra em conflito com outro agendamento ou bloqueio.");
            return;
        }

        setIsSavingAppointment(true);
        const updates = {
            client_name: editAppointmentName.trim(),
            client_phone: formatBrazilianPhone(editAppointmentPhone),
            client_email: editAppointmentEmail.trim() || null,
            service_name: service.name,
            appointment_date: editAppointmentDate,
            start_time: editAppointmentTime,
            duration_minutes: service.duration_minutes,
        };
        const {error} = await supabase.from("appointments").update(updates).eq("id", selectedAdminAppointment.id);
        if (error) {
            console.error("Erro ao editar agendamento:", error);
            setAppointmentEditError("Não foi possível salvar as alterações.");
            setIsSavingAppointment(false);
            return;
        }

        const updated = {...selectedAdminAppointment, ...updates};
        setAppointments((current) => current.map((item) => item.id === updated.id ? updated : item));
        setSelectedAdminAppointment(updated);
        setAgendaDate(editAppointmentDate);
        setIsSavingAppointment(false);
        setAppointmentEditError("");
    }

    async function cancelAppointment(appointment: AdminAppointment) {
        if (!window.confirm(`Cancelar o agendamento de ${appointment.client_name}?`)) return;
        const {error} = await supabase.from("appointments").update({status: "cancelled"}).eq("id", appointment.id);
        if (error) {
            setPanelError("Não foi possível cancelar o agendamento.");
            return;
        }
        setAppointments((current) => current.map((item) => item.id === appointment.id ? {...item, status: "cancelled"} : item));
        setSelectedAdminAppointment((current) => current?.id === appointment.id ? {...current, status: "cancelled"} : current);
    }

    async function deleteAppointment(appointment: AdminAppointment) {
        if (!window.confirm(`Excluir definitivamente o agendamento de ${appointment.client_name}?`)) return;
        const {error} = await supabase.from("appointments").delete().eq("id", appointment.id);
        if (error) {
            setAppointmentEditError("Não foi possível excluir o agendamento.");
            return;
        }
        setAppointments((current) => current.filter((item) => item.id !== appointment.id));
        setSelectedAdminAppointment(null);
    }

    const clients = useMemo<AdminClient[]>(() => {
        const grouped = new Map<string, AdminAppointment[]>();
        appointments.forEach((appointment) => {
            const digits = appointment.client_phone.replace(/\D/g, "");
            const key = digits || appointment.client_name.trim().toLowerCase().replace(/\s+/g, "-");
            grouped.set(key, [...(grouped.get(key) ?? []), appointment]);
        });
        const now = new Date();
        return Array.from(grouped.entries()).map(([key, clientAppointments]) => {
            const ordered = [...clientAppointments].sort((a, b) => getAppointmentDateTime(b).getTime() - getAppointmentDateTime(a).getTime());
            const reference = ordered[0];
            const completed = ordered.filter((item) => item.status !== "cancelled" && getAppointmentDateTime(item).getTime() < now.getTime());
            const upcoming = ordered.filter((item) => item.status !== "cancelled" && getAppointmentDateTime(item).getTime() >= now.getTime())
                .sort((a, b) => getAppointmentDateTime(a).getTime() - getAppointmentDateTime(b).getTime());
            return {
                key,
                name: reference.client_name,
                phone: reference.client_phone,
                email: reference.client_email ?? "",
                appointments: ordered,
                lastAppointment: completed[0] ?? null,
                nextAppointment: upcoming[0] ?? null,
            };
        }).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    }, [appointments]);

    const filteredClients = useMemo(() => {
        const query = clientSearch.trim().toLowerCase();
        const digits = clientSearch.replace(/\D/g, "");
        if (!query) return clients;
        return clients.filter((client) =>
            client.name.toLowerCase().includes(query) ||
            client.phone.toLowerCase().includes(query) ||
            Boolean(digits && client.phone.replace(/\D/g, "").includes(digits)),
        );
    }, [clients, clientSearch]);

    function openClientEditor(client: AdminClient) {
        setEditingClient(client);
        setEditClientName(client.name);
        setEditClientPhone(client.phone);
        setEditClientEmail(client.email);
        setClientEditError("");
    }

    async function saveClientChanges() {
        if (!editingClient) return;
        if (editClientName.trim().length < 3 || editClientPhone.replace(/\D/g, "").length < 10) {
            setClientEditError("Informe nome completo e telefone válido.");
            return;
        }
        setIsSavingClient(true);
        const ids = editingClient.appointments.map((item) => item.id);
        const normalizedPhone = formatBrazilianPhone(editClientPhone);
        const {error} = await supabase.from("appointments").update({
            client_name: editClientName.trim(),
            client_phone: normalizedPhone,
            client_email: editClientEmail.trim() || null,
        }).in("id", ids);
        if (error) {
            setClientEditError("Não foi possível atualizar o cadastro.");
            setIsSavingClient(false);
            return;
        }
        setAppointments((current) => current.map((item) => ids.includes(item.id) ? {
            ...item,
            client_name: editClientName.trim(),
            client_phone: normalizedPhone,
            client_email: editClientEmail.trim() || null,
        } : item));
        setEditingClient(null);
        setIsSavingClient(false);
    }

    async function deleteClient(client: AdminClient) {
        if (!window.confirm(`Excluir ${client.name} e todo o histórico de agendamentos dessa cliente?`)) return;
        setDeletingClientKey(client.key);
        const ids = client.appointments.map((item) => item.id);
        const {error} = await supabase.from("appointments").delete().in("id", ids);
        if (error) {
            setPanelError("Não foi possível excluir a cliente.");
            setDeletingClientKey("");
            return;
        }
        setAppointments((current) => current.filter((item) => !ids.includes(item.id)));
        setDeletingClientKey("");
    }

    const weekDates = useMemo(() => {
        const selected = new Date(`${agendaDate}T12:00:00`);
        const mondayOffset = selected.getDay() === 0 ? -6 : 1 - selected.getDay();
        const monday = addDaysToInputDate(agendaDate, mondayOffset);
        return Array.from({length: 7}, (_, index) => addDaysToInputDate(monday, index));
    }, [agendaDate]);

    const agendaAppointments = useMemo(() =>
            appointments.filter((item) => item.appointment_date === agendaDate)
                .sort((a, b) => getMinutesFromTime(a.start_time) - getMinutesFromTime(b.start_time)),
        [appointments, agendaDate]);

    const weeklyAppointments = useMemo(() =>
            appointments.filter((item) => weekDates.includes(item.appointment_date))
                .sort((a, b) => `${a.appointment_date}${String(a.start_time).slice(0, 5)}`.localeCompare(`${b.appointment_date}${String(b.start_time).slice(0, 5)}`)),
        [appointments, weekDates]);

    const blockAvailableTimes = useMemo(() => {
        const day = new Date(`${blockDate}T12:00:00`).getDay();
        const lastStart = day === 0 || day === 6 ? 13 * 60 : 19 * 60;
        const occupied = appointments.filter((item) => item.appointment_date === blockDate && item.status !== "cancelled")
            .map((item) => {
                const start = getMinutesFromTime(item.start_time);
                return {start, end: start + item.duration_minutes};
            });
        const blocked = adminBlocks.filter((item) => item.block_date === blockDate)
            .map((item) => ({start: getMinutesFromTime(item.start_time), end: getMinutesFromTime(item.end_time)}));
        return Array.from({length: Math.floor((lastStart - 7 * 60) / 30) + 1}, (_, index) => 7 * 60 + index * 30)
            .filter((start) => ![...occupied, ...blocked].some((interval) => intervalsOverlap(start, start + 30, interval.start, interval.end)))
            .map(minutesToTime);
    }, [appointments, adminBlocks, blockDate]);

    useEffect(() => {
        setSelectedBlockTimes((current) => current.filter((time) => blockAvailableTimes.includes(time)));
    }, [blockAvailableTimes]);

    async function saveSelectedBlocks() {
        if (!selectedBlockTimes.length) {
            setBlockError("Selecione pelo menos um horário.");
            return;
        }
        setIsSavingBlock(true);
        setBlockError("");
        const rows = selectedBlockTimes.map((time) => ({
            block_date: blockDate,
            start_time: time,
            end_time: minutesToTime(getMinutesFromTime(time) + 30),
            reason: blockReason.trim() || null,
        }));
        const {data, error} = await supabase.from("schedule_blocks").insert(rows)
            .select("id, block_date, start_time, end_time, reason, created_at");
        if (error) {
            console.error("Erro ao bloquear horários:", error);
            setBlockError("Não foi possível bloquear os horários selecionados.");
            setIsSavingBlock(false);
            return;
        }
        setAdminBlocks((current) => [...current, ...((data ?? []) as AdminScheduleBlock[])]);
        setSelectedBlockTimes([]);
        setBlockReason("");
        setIsSavingBlock(false);
    }

    async function deleteScheduleBlock(blockId: string) {
        const {error} = await supabase.from("schedule_blocks").delete().eq("id", blockId);
        if (error) {
            setBlockError("Não foi possível remover o bloqueio.");
            return;
        }
        setAdminBlocks((current) => current.filter((item) => item.id !== blockId));
    }

    function updateAdminServiceField(serviceId: number, field: "name" | "price_cents" | "duration_minutes", value: string) {
        setAdminServices((current) => current.map((service) => service.id === serviceId ? {
            ...service,
            [field]: field === "name" ? value : Math.max(0, Number(value)),
        } : service));
    }

    async function saveAdminService(service: AdminServiceSetting) {
        setSettingsError("");
        setSettingsSuccess("");
        if (service.name.trim().length < 2 || service.duration_minutes <= 0 || service.price_cents < 0) {
            setSettingsError("Confira o nome, o preço e a duração do serviço.");
            return;
        }
        setSavingServiceId(service.id);
        const {error} = await supabase.from("services").update({
            name: service.name.trim(),
            price_cents: Math.round(service.price_cents),
            duration_minutes: Math.round(service.duration_minutes),
        }).eq("id", service.id);
        if (error) setSettingsError("Não foi possível salvar o serviço.");
        else setSettingsSuccess(`Serviço “${service.name.trim()}” atualizado.`);
        setSavingServiceId(null);
    }

    function updateAdminHoursField(hoursId: number, field: "start_time" | "end_time", value: string) {
        setAdminBusinessHours((current) => current.map((hours) => hours.id === hoursId ? {...hours, [field]: value} : hours));
    }

    async function saveAdminHours(hours: AdminBusinessHour) {
        setSettingsError("");
        setSettingsSuccess("");
        setSavingHoursId(hours.id);
        const {error} = await supabase.from("business_hours").update({
            start_time: hours.start_time,
            end_time: hours.end_time,
        }).eq("id", hours.id);
        if (error) setSettingsError("Não foi possível salvar os horários.");
        else setSettingsSuccess(`${dayNames[hours.day_of_week]} atualizado.`);
        setSavingHoursId(null);
    }

    const renderAppointmentCard = (appointment: AdminAppointment) => (
        <article
            key={appointment.id}
            className={`admin-booking-card${appointment.status === "cancelled" ? " is-cancelled" : ""}`}
            onClick={() => openAppointmentDetails(appointment)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") openAppointmentDetails(appointment);
            }}
        >
            <div className="admin-booking-card__top">
                <div>
                    <span className="admin-booking-card__time">{String(appointment.start_time).slice(0, 5)}</span>
                    <h3>{appointment.client_name}</h3>
                </div>
                <span className={`admin-status admin-status--${appointment.status}`}>{appointment.status === "cancelled" ? "Cancelado" : "Confirmado"}</span>
            </div>
            <div className="admin-booking-card__details">
                <div><span>Data</span><strong>{formatAdminDate(appointment.appointment_date)}</strong></div>
                <div><span>Serviço</span><strong>{appointment.service_name}</strong></div>
                <div><span>Duração</span><strong>{appointment.duration_minutes} min</strong></div>
                <div><span>Telefone</span><strong>{appointment.client_phone}</strong></div>
            </div>
            <div className="admin-booking-card__footer" onClick={(event) => event.stopPropagation()}>
                <button type="button" onClick={() => openAppointmentDetails(appointment)}>Editar detalhes</button>
                {appointment.status !== "cancelled" && <button type="button" onClick={() => void cancelAppointment(appointment)}>Cancelar</button>}
                <a
                    href={`https://wa.me/${normalizePhoneForWhatsApp(appointment.client_phone)}?text=${encodeURIComponent(`Olá, ${appointment.client_name}! Estou entrando em contato sobre seu agendamento de ${appointment.service_name}, no dia ${formatAdminDate(appointment.appointment_date)}, às ${String(appointment.start_time).slice(0, 5)}.`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    WhatsApp
                </a>
            </div>
        </article>
    );

    if (isCheckingSession) {
        return <main className="admin-page"><style>{adminStyles + adminEnhancementStyles}</style><div className="admin-login"><div className="admin-loading">Verificando acesso...</div></div></main>;
    }

    if (!isAuthenticated) {
        return (
            <main className="admin-page">
                <style>{adminStyles + adminEnhancementStyles}</style>
                <div className="admin-login">
                    <form className="admin-login__card" onSubmit={handleLogin}>
                        <div className="admin-login__brand"><span className="admin-login__symbol">MS</span><div><strong>Mirian Silva</strong><span>Painel administrativo</span></div></div>
                        <h1>Acesso da Mirian</h1>
                        <p>Entre com o e-mail e a senha cadastrados no Supabase.</p>
                        {loginError && <p className="admin-login__error">{loginError}</p>}
                        <div className="admin-field"><label htmlFor="admin-email">E-mail</label><input id="admin-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required/></div>
                        <div className="admin-field"><label htmlFor="admin-password">Senha</label><input id="admin-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required/></div>
                        <button className="admin-primary-button" type="submit" disabled={isLoggingIn}>{isLoggingIn ? "Entrando..." : "Entrar no painel"}</button>
                    </form>
                </div>
            </main>
        );
    }

    return (
        <main className="admin-page">
            <style>{adminStyles + adminEnhancementStyles}</style>
            <section className="admin-panel">
                <header className="admin-header">
                    <div><h1>Painel da Mirian</h1><p>Gerencie os agendamentos recebidos pelo site.</p></div>
                    <button className="admin-secondary-button" type="button" onClick={handleLogout}>Sair</button>
                </header>

                <div className="admin-dashboard-cards">
                    <button className={`admin-dashboard-card${adminView === "agenda" ? " is-active" : ""}`} type="button" onClick={() => setAdminView("agenda")}><strong>Agenda do dia</strong><span>Veja todos os atendimentos do dia.</span></button>
                    <button className={`admin-dashboard-card${adminView === "week" ? " is-active" : ""}`} type="button" onClick={() => setAdminView("week")}><strong>Agenda semanal</strong><span>Atendimentos em ordem de dia e horário.</span></button>
                    <button className={`admin-dashboard-card${adminView === "clients" ? " is-active" : ""}`} type="button" onClick={() => setAdminView("clients")}><strong>Clientes</strong><span>Cadastros, histórico e indicadores.</span></button>
                    <button className={`admin-dashboard-card${adminView === "settings" ? " is-active" : ""}`} type="button" onClick={() => setAdminView("settings")}><strong>Configurações</strong><span>Serviços e horários do site.</span></button>
                </div>

                {(adminView === "agenda" || adminView === "week") && (
                    <section className="admin-top-agenda">
                        <div className="admin-top-agenda__header">
                            <div>
                                <span>{adminView === "agenda" ? "Atendimentos do dia" : "Atendimentos da semana"}</span>
                                <strong>
                                    {adminView === "agenda"
                                        ? formatAdminDate(agendaDate)
                                        : `${formatAdminDate(weekDates[0])} até ${formatAdminDate(weekDates[6])}`}
                                </strong>
                            </div>
                            <div className="admin-section-date-controls">
                                <button type="button" onClick={() => setAgendaDate((current) => addDaysToInputDate(current, adminView === "week" ? -7 : -1))}>←</button>
                                <input type="date" value={agendaDate} onChange={(event) => setAgendaDate(event.target.value)}/>
                                <button type="button" onClick={() => setAgendaDate((current) => addDaysToInputDate(current, adminView === "week" ? 7 : 1))}>→</button>
                                <button type="button" onClick={() => setAgendaDate(formatDateForInput(new Date()))}>Hoje</button>
                            </div>
                        </div>

                        {isLoading ? (
                            <div className="admin-loading">Carregando...</div>
                        ) : adminView === "agenda" ? (
                            <div className="admin-card-list">
                                {agendaAppointments.length
                                    ? agendaAppointments.map(renderAppointmentCard)
                                    : <div className="admin-empty admin-empty--top">Nenhum agendamento nesta data.</div>}
                            </div>
                        ) : (
                            <div className="admin-card-list">
                                {weeklyAppointments.length
                                    ? weeklyAppointments.map(renderAppointmentCard)
                                    : <div className="admin-empty admin-empty--top">Nenhum agendamento nesta semana.</div>}
                            </div>
                        )}
                    </section>
                )}

                {panelError && <p className="admin-panel__error">{panelError}</p>}

                {adminView === "settings" ? (
                    <section className="admin-settings">
                        <div className="admin-settings__intro"><div><span className="admin-settings__eyebrow">Configurações do site</span><h2>Serviços e horários</h2><p>As alterações salvas aqui aparecem no agendamento das clientes.</p></div></div>
                        {settingsError && <p className="admin-settings__message admin-settings__message--error">{settingsError}</p>}
                        {settingsSuccess && <p className="admin-settings__message admin-settings__message--success">{settingsSuccess}</p>}
                        <div className="admin-settings__section">
                            <div className="admin-settings__section-header"><h3>Serviços</h3><p>Edite nome, preço e duração.</p></div>
                            <div className="admin-settings__list">
                                {adminServices.map((service) => (
                                    <article className="admin-settings__service" key={service.id}>
                                        <label>Nome do serviço<input value={service.name} onChange={(event) => updateAdminServiceField(service.id, "name", event.target.value)}/></label>
                                        <label>Preço (R$)<input type="number" min="0" step="0.01" value={(service.price_cents / 100).toFixed(2)} onChange={(event) => updateAdminServiceField(service.id, "price_cents", String(Math.round(Number(event.target.value) * 100)))}/></label>
                                        <label>Duração (minutos)<input type="number" min="1" step="5" value={service.duration_minutes} onChange={(event) => updateAdminServiceField(service.id, "duration_minutes", event.target.value)}/></label>
                                        <button type="button" disabled={savingServiceId === service.id} onClick={() => void saveAdminService(service)}>{savingServiceId === service.id ? "Salvando..." : "Salvar"}</button>
                                    </article>
                                ))}
                            </div>
                        </div>
                        <div className="admin-settings__section">
                            <div className="admin-settings__section-header"><h3>Horários das clientes</h3><p>Defina o primeiro e o último horário de início.</p></div>
                            <div className="admin-settings__list">
                                {adminBusinessHours.map((hours) => (
                                    <article className="admin-settings__hours" key={hours.id}>
                                        <strong>{dayNames[hours.day_of_week]}</strong>
                                        <label>Primeiro horário<input type="time" step="1800" value={hours.start_time} onChange={(event) => updateAdminHoursField(hours.id, "start_time", event.target.value)}/></label>
                                        <label>Último início<input type="time" step="1800" value={hours.end_time} onChange={(event) => updateAdminHoursField(hours.id, "end_time", event.target.value)}/></label>
                                        <button type="button" disabled={savingHoursId === hours.id} onClick={() => void saveAdminHours(hours)}>{savingHoursId === hours.id ? "Salvando..." : "Salvar"}</button>
                                    </article>
                                ))}
                            </div>
                        </div>
                    </section>
                ) : adminView === "clients" ? (
                    <section className="admin-clients">
                        <div className="admin-clients__header"><div><span className="admin-clients__eyebrow">Clientes</span><h2>Cadastros das clientes</h2><p>Consulte histórico, edite ou exclua um cadastro.</p></div><div className="admin-clients__count"><strong>{clients.length}</strong><span>clientes cadastradas</span></div></div>
                        <div className="admin-clients__search"><label>Buscar cliente<input value={clientSearch} onChange={(event) => setClientSearch(event.target.value)} placeholder="Nome ou telefone"/></label></div>
                        <div className="admin-clients__grid">
                            {filteredClients.map((client) => {
                                const realized = client.appointments.filter((item) => item.status !== "cancelled" && getAppointmentDateTime(item).getTime() < Date.now()).length;
                                const cancelled = client.appointments.filter((item) => item.status === "cancelled").length;
                                return (
                                    <article className="admin-client-card" key={client.key}>
                                        <div className="admin-client-card__top"><div className="admin-client-card__avatar">{client.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</div><div><h3>{client.name}</h3><a href={`https://wa.me/${normalizePhoneForWhatsApp(client.phone)}`} target="_blank" rel="noopener noreferrer">{client.phone}</a><span>{client.email || "E-mail não informado"}</span></div></div>
                                        <div className="admin-client-card__metrics"><div><span>Atendimentos realizados</span><strong>{realized}</strong></div><div><span>Atendimentos cancelados</span><strong>{cancelled}</strong></div></div>
                                        {client.nextAppointment && <div className="admin-client-card__next"><span>Próximo</span><strong>{formatAdminDate(client.nextAppointment.appointment_date)} às {String(client.nextAppointment.start_time).slice(0, 5)}</strong></div>}
                                        <div className="admin-client-card__actions">
                                            <button type="button" onClick={() => setSelectedClient(client)}>Ver histórico</button>
                                            <button type="button" className="is-secondary" onClick={() => openClientEditor(client)}>Editar cadastro</button>
                                            <button type="button" className="is-danger" disabled={deletingClientKey === client.key} onClick={() => void deleteClient(client)}>{deletingClientKey === client.key ? "Excluindo..." : "Excluir cliente"}</button>
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    </section>
                ) : (
                    <section className="admin-content-section">
                        <section className="admin-new-appointment">
                            <div className="admin-new-appointment__header"><div><h2>Novo agendamento</h2><p>A Mirian pode cadastrar qualquer horário, inclusive fora do expediente das clientes.</p></div><button className="admin-new-appointment__toggle" type="button" onClick={() => setShowManualForm((current) => !current)}>{showManualForm ? "Fechar" : "+ Adicionar"}</button></div>
                            {showManualForm && (
                                <form className="admin-manual-form" onSubmit={createManualAppointment}>
                                    <label>Nome da cliente<input value={manualClientName} onChange={(event) => setManualClientName(event.target.value)} required/></label>
                                    <label>Telefone<input value={manualClientPhone} onChange={(event) => setManualClientPhone(event.target.value)} required/></label>
                                    <label className="admin-manual-form__email">E-mail<input type="email" value={manualClientEmail} onChange={(event) => setManualClientEmail(event.target.value)}/></label>
                                    <label>Serviço<select value={manualServiceName} onChange={(event) => setManualServiceName(event.target.value)}>{adminServices.map((service) => <option key={service.id} value={service.name}>{service.name} — {service.duration_minutes} min</option>)}</select></label>
                                    <label>Data<input type="date" value={manualDate} onChange={(event) => setManualDate(event.target.value)} required/></label>
                                    <label>Horário<select value={manualTime} onChange={(event) => setManualTime(event.target.value)}>{allDayTimes.map((time) => <option key={time} value={time}>{time}</option>)}</select></label>
                                    <div className="admin-manual-form__actions"><button className="admin-manual-form__save" type="submit" disabled={isSavingManualAppointment}>{isSavingManualAppointment ? "Criando..." : "Criar agendamento"}</button><button className="admin-manual-form__cancel" type="button" onClick={() => setShowManualForm(false)}>Cancelar</button></div>
                                    {manualError && <p className="admin-manual-form__error">{manualError}</p>}
                                    {manualSuccess && <p className="admin-manual-form__success">{manualSuccess}</p>}
                                </form>
                            )}
                        </section>

                        <section className="admin-block-manager admin-block-manager--bottom">
                            <div className="admin-block-manager__header"><div><h2>Bloquear horários</h2><p>Selecione uma data e marque vários horários livres de uma só vez.</p></div></div>
                            <div className="admin-block-date-row"><label>Data<input type="date" value={blockDate} onChange={(event) => {setBlockDate(event.target.value); setSelectedBlockTimes([]); setBlockError("");}}/></label><div><strong>{selectedBlockTimes.length} horário(s) selecionado(s)</strong><p>Os cards representam períodos de 30 minutos.</p></div></div>
                            <div className="admin-block-times">
                                {blockAvailableTimes.map((time) => <button key={time} className={`admin-block-time${selectedBlockTimes.includes(time) ? " is-selected" : ""}`} type="button" onClick={() => setSelectedBlockTimes((current) => current.includes(time) ? current.filter((item) => item !== time) : [...current, time])}>{time}</button>)}
                            </div>
                            {!blockAvailableTimes.length && <div className="admin-empty">Não há horários livres nesta data.</div>}
                            <div className="admin-block-submit-row"><input value={blockReason} onChange={(event) => setBlockReason(event.target.value)} placeholder="Motivo opcional"/><button type="button" disabled={isSavingBlock || !selectedBlockTimes.length} onClick={() => void saveSelectedBlocks()}>{isSavingBlock ? "Bloqueando..." : "Bloquear selecionados"}</button></div>
                            {blockError && <p className="admin-block-error">{blockError}</p>}
                            <div className="admin-block-list">
                                {adminBlocks.filter((item) => item.block_date === blockDate).map((block) => <div className="admin-block-item" key={block.id}><div><strong>{String(block.start_time).slice(0, 5)}–{String(block.end_time).slice(0, 5)}</strong><span>{block.reason || "Horário bloqueado"}</span></div><button type="button" onClick={() => void deleteScheduleBlock(block.id)}>Remover</button></div>)}
                            </div>
                        </section>
                    </section>
                )}

                {selectedAdminAppointment && (
                    <div className="admin-modal-backdrop" onMouseDown={(event) => {if (event.target === event.currentTarget) setSelectedAdminAppointment(null);}}>
                        <section className="admin-modal">
                            <div className="admin-modal__header"><div><h2>Editar agendamento</h2><p>Altere os dados, cancele ou exclua.</p></div><button className="admin-modal__close" type="button" onClick={() => setSelectedAdminAppointment(null)}>×</button></div>
                            <div className="admin-modal__body">
                                <div className="admin-edit-form">
                                    <label>Nome da cliente<input value={editAppointmentName} onChange={(event) => setEditAppointmentName(event.target.value)}/></label>
                                    <label>Telefone<input value={editAppointmentPhone} onChange={(event) => setEditAppointmentPhone(event.target.value)}/></label>
                                    <label className="admin-edit-form__full">E-mail<input type="email" value={editAppointmentEmail} onChange={(event) => setEditAppointmentEmail(event.target.value)}/></label>
                                    <label>Serviço<select value={editAppointmentService} onChange={(event) => setEditAppointmentService(event.target.value)}>{adminServices.map((service) => <option key={service.id} value={service.name}>{service.name}</option>)}</select></label>
                                    <label>Data<input type="date" value={editAppointmentDate} onChange={(event) => setEditAppointmentDate(event.target.value)}/></label>
                                    <label>Horário<select value={editAppointmentTime} onChange={(event) => setEditAppointmentTime(event.target.value)}>{allDayTimes.map((time) => <option key={time} value={time}>{time}</option>)}</select></label>
                                    {appointmentEditError && <p className="admin-reschedule__message admin-edit-form__full">{appointmentEditError}</p>}
                                    <div className="admin-edit-actions">
                                        <button className="save" type="button" disabled={isSavingAppointment} onClick={() => void saveAppointmentChanges()}>{isSavingAppointment ? "Salvando..." : "Salvar alterações"}</button>
                                        {selectedAdminAppointment.status !== "cancelled" && <button className="cancel" type="button" onClick={() => void cancelAppointment(selectedAdminAppointment)}>Cancelar agendamento</button>}
                                        <button className="delete" type="button" onClick={() => void deleteAppointment(selectedAdminAppointment)}>Excluir agendamento</button>
                                        <button className="close" type="button" onClick={() => setSelectedAdminAppointment(null)}>Fechar</button>
                                    </div>
                                </div>
                            </div>
                        </section>
                    </div>
                )}

                {selectedClient && (
                    <div className="admin-modal-backdrop" onMouseDown={(event) => {if (event.target === event.currentTarget) setSelectedClient(null);}}>
                        <section className="admin-client-history">
                            <button className="admin-modal__close" type="button" onClick={() => setSelectedClient(null)}>×</button>
                            <h2>Histórico de {selectedClient.name}</h2>
                            <p>{selectedClient.phone} • {selectedClient.email || "E-mail não informado"}</p>
                            <div className="admin-client-history__list">{selectedClient.appointments.map((appointment) => <article key={appointment.id}><div><strong>{appointment.service_name}</strong><span>{formatAdminDate(appointment.appointment_date)} às {String(appointment.start_time).slice(0, 5)}</span></div><span>{appointment.status === "cancelled" ? "Cancelado" : "Confirmado"}</span></article>)}</div>
                        </section>
                    </div>
                )}

                {editingClient && (
                    <div className="admin-modal-backdrop" onMouseDown={(event) => {if (event.target === event.currentTarget) setEditingClient(null);}}>
                        <section className="admin-client-editor">
                            <button className="admin-modal__close" type="button" onClick={() => setEditingClient(null)}>×</button>
                            <h2>Editar cadastro</h2>
                            <label>Nome<input value={editClientName} onChange={(event) => setEditClientName(event.target.value)}/></label>
                            <label>Telefone<input value={editClientPhone} onChange={(event) => setEditClientPhone(event.target.value)}/></label>
                            <label>E-mail<input type="email" value={editClientEmail} onChange={(event) => setEditClientEmail(event.target.value)}/></label>
                            {clientEditError && <p className="admin-reschedule__message">{clientEditError}</p>}
                            <button className="admin-primary-button" type="button" disabled={isSavingClient} onClick={() => void saveClientChanges()}>{isSavingClient ? "Salvando..." : "Salvar cadastro"}</button>
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

